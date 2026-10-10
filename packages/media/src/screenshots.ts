import type { DbOrTx } from "@repo/db";
import sharp from "sharp";
import { saveImageAsset, type MediaAssetRow } from "./assets";
import type { StorageDriver } from "./storage";
import { mediaUrl } from "./urls";

/**
 * Screenshot processing (FR-MED-3): crop, annotate (arrows, boxes, labels) and frame (browser
 * window or phone bezel) research screenshots. Pure image work with sharp + SVG overlays; the
 * original asset is never modified, results are stored as new assets pointing at it.
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Annotation {
  type: "arrow" | "box" | "label";
  /** Position in pixels of the (cropped) screenshot. Arrows run from (x, y) to (x + w, y + h). */
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
}

export interface ProcessScreenshotOptions {
  crop?: CropRect | null;
  frame?: "browser" | "phone" | null;
  annotations?: Annotation[];
  /** Host shown in the browser frame's address bar, e.g. "plausible.io". */
  host?: string | null;
  /** Downscale the result to at most this width (frames are drawn at full size first). */
  maxWidth?: number;
}

export interface ProcessedScreenshot {
  bytes: Buffer;
  mimeType: "image/webp";
  width: number;
  height: number;
}

const ACCENT = "#ef4444";
const FONT = "Inter, Helvetica, Arial, sans-serif";

export function escapeXml(text: string): string {
  return text.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

/** Clamps a crop rectangle to the image; null when it leaves nothing to show. */
export function clampCrop(crop: CropRect, width: number, height: number): CropRect | null {
  const x = Math.max(0, Math.min(Math.round(crop.x), width - 1));
  const y = Math.max(0, Math.min(Math.round(crop.y), height - 1));
  const w = Math.min(Math.round(crop.width), width - x);
  const h = Math.min(Math.round(crop.height), height - y);
  return w >= 8 && h >= 8 ? { x, y, width: w, height: h } : null;
}

/** SVG markup for annotations on a `width` × `height` image. Stroke scales with image width. */
export function annotationSvg(annotations: Annotation[], width: number, height: number): string {
  const stroke = Math.max(3, Math.round(width / 320));
  const fontSize = Math.max(16, Math.round(width / 60));
  const parts = annotations.map((a, i) => {
    if (a.type === "box") {
      return `<rect x="${a.x}" y="${a.y}" width="${Math.max(1, a.w ?? 100)}" height="${Math.max(1, a.h ?? 60)}" rx="${stroke * 2}" fill="none" stroke="${ACCENT}" stroke-width="${stroke}"/>`;
    }
    if (a.type === "arrow") {
      const x2 = a.x + (a.w ?? 80);
      const y2 = a.y + (a.h ?? 0);
      return `<line x1="${a.x}" y1="${a.y}" x2="${x2}" y2="${y2}" stroke="${ACCENT}" stroke-width="${stroke}" stroke-linecap="round" marker-end="url(#head${i})"/><defs><marker id="head${i}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${ACCENT}"/></marker></defs>`;
    }
    const text = escapeXml((a.text ?? "").slice(0, 80));
    const padX = Math.round(fontSize * 0.6);
    const boxW = Math.round(text.length * fontSize * 0.58 + padX * 2);
    const boxH = Math.round(fontSize * 1.8);
    return `<g><rect x="${a.x}" y="${a.y}" width="${boxW}" height="${boxH}" rx="${boxH / 2}" fill="${ACCENT}"/><text x="${a.x + padX}" y="${a.y + boxH * 0.66}" font-family="${FONT}" font-size="${fontSize}" font-weight="600" fill="#ffffff">${text}</text></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`;
}

/** Browser window chrome: rounded window, title bar with traffic lights and an address pill. */
function browserFrame(width: number, height: number, host: string | null) {
  const bar = Math.max(40, Math.round(width / 28));
  const pad = Math.round(bar * 0.8);
  const radius = Math.round(bar * 0.3);
  const outerW = width + pad * 2;
  const outerH = height + bar + pad * 2;
  const dot = Math.round(bar * 0.14);
  const dots = ["#ff5f57", "#febc2e", "#28c840"]
    .map((c, i) => `<circle cx="${pad + bar * 0.45 + i * dot * 3.2}" cy="${pad + bar / 2}" r="${dot}" fill="${c}"/>`)
    .join("");
  const pillW = Math.min(width * 0.5, Math.max(200, width * 0.4));
  const pillX = pad + (width - pillW) / 2;
  const pillH = bar * 0.56;
  const font = Math.round(bar * 0.34);
  const label = host ? escapeXml(host.slice(0, 60)) : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outerW}" height="${outerH}">
<defs><clipPath id="win"><rect x="${pad}" y="${pad}" width="${width}" height="${height + bar}" rx="${radius}"/></clipPath>
<filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="${Math.round(pad / 4)}" stdDeviation="${Math.round(pad / 3)}" flood-color="#0f172a" flood-opacity="0.18"/></filter></defs>
<rect width="${outerW}" height="${outerH}" fill="#eef2f7"/>
<rect x="${pad}" y="${pad}" width="${width}" height="${height + bar}" rx="${radius}" fill="#ffffff" filter="url(#sh)"/>
<g clip-path="url(#win)"><rect x="${pad}" y="${pad}" width="${width}" height="${bar}" fill="#f1f3f6"/>
<line x1="${pad}" y1="${pad + bar - 0.5}" x2="${pad + width}" y2="${pad + bar - 0.5}" stroke="#d8dde5"/></g>
${dots}
<rect x="${pillX}" y="${pad + (bar - pillH) / 2}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#ffffff" stroke="#d8dde5"/>
<text x="${pillX + pillW / 2}" y="${pad + bar / 2 + font * 0.35}" text-anchor="middle" font-family="${FONT}" font-size="${font}" fill="#475569">${label}</text>
</svg>`;
  return { svg, outerW, outerH, left: pad, top: pad + bar, radius };
}

/** Phone bezel: dark rounded body around the screen with a camera pill. */
function phoneFrame(width: number, height: number) {
  const bezel = Math.max(16, Math.round(width / 22));
  const pad = Math.round(bezel * 1.5);
  const radius = Math.round(width / 8);
  const outerW = width + (bezel + pad) * 2;
  const outerH = height + (bezel + pad) * 2;
  const pillW = Math.round(width * 0.28);
  const pillH = Math.round(bezel * 0.9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outerW}" height="${outerH}">
<rect width="${outerW}" height="${outerH}" fill="#eef2f7"/>
<rect x="${pad}" y="${pad}" width="${width + bezel * 2}" height="${height + bezel * 2}" rx="${radius + bezel}" fill="#111827"/>
</svg>`;
  const pill = `<svg xmlns="http://www.w3.org/2000/svg" width="${outerW}" height="${outerH}"><rect x="${(outerW - pillW) / 2}" y="${pad + bezel + Math.round(bezel * 0.5)}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#111827"/></svg>`;
  return { svg, pill, outerW, outerH, left: pad + bezel, top: pad + bezel, radius };
}

function roundedMask(width: number, height: number, radius: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></svg>`,
  );
}

/** Mask with only the bottom corners rounded (the browser title bar covers the top). */
function bottomRoundedMask(width: number, height: number, r: number): Buffer {
  const d = `M0,0 H${width} V${height - r} Q${width},${height} ${width - r},${height} H${r} Q0,${height} 0,${height - r} Z`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${d}" fill="#fff"/></svg>`,
  );
}

/** Crop → annotate → frame → WebP (FR-MED-3). */
export async function processScreenshot(
  input: Buffer,
  opts: ProcessScreenshotOptions = {},
): Promise<ProcessedScreenshot> {
  let img = sharp(input, { failOn: "error" }).rotate();
  const meta = await img.metadata();
  let width = meta.width ?? 0;
  let height = meta.height ?? 0;
  if (!width || !height) throw new Error("Unreadable image");

  if (opts.crop) {
    const crop = clampCrop(opts.crop, width, height);
    if (crop) {
      img = sharp(
        await img.extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).png().toBuffer(),
      );
      width = crop.width;
      height = crop.height;
    }
  }
  const annotations = (opts.annotations ?? []).filter((a) => a.type !== "label" || a.text?.trim());
  let screen = annotations.length
    ? await img
        .composite([{ input: Buffer.from(annotationSvg(annotations, width, height)), top: 0, left: 0 }])
        .png()
        .toBuffer()
    : await img.png().toBuffer();

  if (opts.frame === "browser") {
    const f = browserFrame(width, height, opts.host ?? null);
    // Round the bottom corners of the page to match the window.
    screen = await sharp(screen)
      .ensureAlpha()
      .composite([{ input: bottomRoundedMask(width, height, f.radius), blend: "dest-in" }])
      .png()
      .toBuffer();
    screen = await sharp(Buffer.from(f.svg))
      .composite([{ input: screen, left: f.left, top: f.top }])
      .png()
      .toBuffer();
    width = f.outerW;
  } else if (opts.frame === "phone") {
    const f = phoneFrame(width, height);
    screen = await sharp(screen)
      .ensureAlpha()
      .composite([{ input: roundedMask(width, height, f.radius), blend: "dest-in" }])
      .png()
      .toBuffer();
    screen = await sharp(Buffer.from(f.svg))
      .composite([
        { input: screen, left: f.left, top: f.top },
        { input: Buffer.from(f.pill), left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    width = f.outerW;
  }

  let out = sharp(screen);
  if (opts.maxWidth && width > opts.maxWidth) out = out.resize({ width: opts.maxWidth });
  const res = await out.webp({ quality: 88, effort: 4 }).toBuffer({ resolveWithObject: true });
  return { bytes: res.data, mimeType: "image/webp", width: res.info.width, height: res.info.height };
}

/** Bytes of a stored asset: from the storage driver when it can read, else from its public URL. */
export async function readAssetBytes(
  asset: Pick<MediaAssetRow, "storage" | "storageKey" | "variants">,
  storage: StorageDriver | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  if (storage?.get && storage.kind === asset.storage) {
    const bytes = await storage.get(asset.storageKey);
    if (bytes) return bytes;
  }
  const res = await fetchImpl(mediaUrl(asset), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Could not read asset ${asset.storageKey}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Processes a stored screenshot and saves the result as a new asset linked to the original
 * (`parentAssetId`). Processed images are stored as `graphic` assets so the writer keeps choosing
 * among original evidence screenshots; role is `<original role>:processed`.
 */
export async function saveProcessedScreenshot(
  db: DbOrTx,
  storage: StorageDriver,
  parent: MediaAssetRow,
  opts: ProcessScreenshotOptions,
  extra: { alt?: string | null; fetch?: typeof fetch } = {},
): Promise<MediaAssetRow> {
  const original = await readAssetBytes(parent, storage, extra.fetch);
  const processed = await processScreenshot(original, opts);
  return saveImageAsset(db, storage, {
    bytes: processed.bytes,
    kind: "graphic",
    origin: "templated",
    prefix: parent.productId ? `products/${parent.productId}/processed` : "media/processed",
    role: `${parent.role ?? "screenshot"}:processed`,
    alt: extra.alt ?? parent.alt,
    productId: parent.productId,
    articleId: parent.articleId,
    capturedAt: parent.capturedAt,
    licenseNote: parent.licenseNote,
    parentAssetId: parent.id,
  });
}

/**
 * Parses the CMS annotation field, one per line (FR-MED-3):
 * `box x y w h`, `arrow x y dx dy`, `label x y Some text`. Invalid lines are reported, not dropped silently.
 */
export function parseAnnotations(text: string): { annotations: Annotation[]; errors: string[] } {
  const annotations: Annotation[] = [];
  const errors: string[] = [];
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20)
    .forEach((line, i) => {
      const [type, ...rest] = line.split(/\s+/);
      const nums = rest.map(Number);
      if (type === "box" || type === "arrow") {
        if (nums.length < 4 || nums.slice(0, 4).some((n) => !Number.isFinite(n))) {
          errors.push(`Line ${i + 1}: "${type}" needs four numbers`);
          return;
        }
        annotations.push({ type, x: nums[0]!, y: nums[1]!, w: nums[2]!, h: nums[3]! });
      } else if (type === "label") {
        const [x, y] = nums;
        const label = rest.slice(2).join(" ");
        if (!Number.isFinite(x) || !Number.isFinite(y) || !label) {
          errors.push(`Line ${i + 1}: "label" needs x, y and text`);
          return;
        }
        annotations.push({ type, x: x!, y: y!, text: label });
      } else {
        errors.push(`Line ${i + 1}: unknown annotation "${type}" (use box, arrow or label)`);
      }
    });
  return { annotations, errors };
}
