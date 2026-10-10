import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPOSITION_IDS, type VideoInputProps } from "./types";

/**
 * Node-side rendering (FR-VID-3): bundles the Remotion project, serves local assets to the
 * headless browser, renders MP4 (H.264 + AAC) and thumbnail stills. Remotion ships its own
 * ffmpeg (compositor binaries) and downloads Chrome Headless Shell on first use.
 */

const ENTRY = fileURLToPath(new URL("./entry.ts", import.meta.url));
/** Prebuilt bundle (`pnpm --filter @repo/video bundle`); shipped to the worker with additionalFiles. */
const PACKAGE_BUILD = fileURLToPath(new URL("../build", import.meta.url));

/** Where a prebuilt bundle lives: REMOTION_BUNDLE_DIR, the deployed worker copy, or this package's build/. */
export function prebuiltBundleDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [env.REMOTION_BUNDLE_DIR, join(process.cwd(), "packages/video/build"), PACKAGE_BUILD];
  for (const dir of candidates) if (dir && existsSync(join(dir, "index.html"))) return dir;
  return null;
}

/** Bundles the compositions with webpack (slow: ~10–30 s). */
export async function bundleProject(outDir?: string): Promise<string> {
  const { bundle } = await import("@remotion/bundler");
  return bundle({ entryPoint: ENTRY, outDir: outDir ?? null, enableCaching: true });
}

let serveUrlPromise: Promise<string> | null = null;
/** A prebuilt bundle when present, otherwise a fresh bundle (cached per process). */
export function getServeUrl(): Promise<string> {
  serveUrlPromise ??= Promise.resolve(prebuiltBundleDir()).then((dir) => dir ?? bundleProject());
  return serveUrlPromise;
}

export interface AssetServer {
  /** Registers bytes and returns the URL the renderer can fetch them from. */
  add(name: string, bytes: Buffer, mimeType: string): string;
  close(): Promise<void>;
}

/**
 * Tiny loopback HTTP server for assets (audio, screenshots, fonts) so renders do not depend on
 * public URLs (DB-stored media has none in the worker) or oversized input props. Supports byte
 * ranges, which Chrome uses for media.
 */
export async function startAssetServer(): Promise<AssetServer> {
  const files = new Map<string, { bytes: Buffer; mimeType: string }>();
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? "/").split("?")[0]!.slice(1));
    const file = files.get(name);
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    const headers = { "Content-Type": file.mimeType, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      const size = file.bytes.length;
      const start = range[1] ? Number(range[1]) : size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
      });
      res.end(file.bytes.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": file.bytes.length });
    res.end(req.method === "HEAD" ? undefined : file.bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    add(name, bytes, mimeType) {
      const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
      files.set(safe, { bytes, mimeType });
      return `http://127.0.0.1:${port}/${encodeURIComponent(safe)}`;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export interface RenderVideoOptions {
  props: VideoInputProps;
  outPath: string;
  serveUrl?: string;
  /** Parallel browser tabs; defaults to Remotion's (half the CPUs). */
  concurrency?: number | null;
  onProgress?: (progress: number) => void;
}

async function composition(props: VideoInputProps, serveUrl: string) {
  const { selectComposition } = await import("@remotion/renderer");
  return selectComposition({ serveUrl, id: COMPOSITION_IDS[props.kind], inputProps: props, logLevel: "error" });
}

/** Renders the MP4 for a short or long video. */
export async function renderVideo(opts: RenderVideoOptions): Promise<{ outPath: string; durationInFrames: number }> {
  const { renderMedia, ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser();
  const serveUrl = opts.serveUrl ?? (await getServeUrl());
  const comp = await composition(opts.props, serveUrl);
  await renderMedia({
    composition: comp,
    serveUrl,
    codec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    crf: 23,
    outputLocation: opts.outPath,
    inputProps: opts.props,
    concurrency: opts.concurrency ?? null,
    logLevel: "error",
    onProgress: ({ progress }) => opts.onProgress?.(progress),
  });
  return { outPath: opts.outPath, durationInFrames: comp.durationInFrames };
}

/**
 * Thumbnail candidates (FR-VID-3): stills from the title, score and first screenshot scenes,
 * taken once their entrance animation has settled.
 */
export async function renderThumbnails(opts: {
  props: VideoInputProps;
  outDir: string;
  serveUrl?: string;
  max?: number;
}): Promise<string[]> {
  const { renderStill, ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser();
  const serveUrl = opts.serveUrl ?? (await getServeUrl());
  const comp = await composition(opts.props, serveUrl);
  await mkdir(opts.outDir, { recursive: true });
  const picks = thumbnailFrames(opts.props, opts.max ?? 3);
  const out: string[] = [];
  for (const [i, frame] of picks.entries()) {
    const output = join(opts.outDir, `thumb-${i + 1}.jpg`);
    await renderStill({
      composition: comp,
      serveUrl,
      frame: Math.min(frame, comp.durationInFrames - 1),
      output,
      imageFormat: "jpeg",
      jpegQuality: 90,
      inputProps: opts.props,
      logLevel: "error",
    });
    out.push(output);
  }
  return out;
}

/** Frames worth a thumbnail: ~1.5 s into the title, score and first screenshot scenes. */
export function thumbnailFrames(props: VideoInputProps, max: number): number[] {
  const order = ["title", "score", "screenshot", "verdict"] as const;
  const frames: number[] = [];
  for (const visual of order) {
    const scene = props.scenes.find((s) => s.visual === visual);
    if (scene) frames.push(scene.startFrame + Math.min(45, Math.max(0, scene.durationFrames - 5)));
  }
  if (frames.length === 0) frames.push(Math.min(45, props.durationInFrames - 1));
  return frames.slice(0, max);
}
