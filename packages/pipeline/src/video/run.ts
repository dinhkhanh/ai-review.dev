import { articlePath } from "@repo/content";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElevenLabsTts, createYouTubeUploader, type CostHandler, type Tts, type YouTubeUploader } from "@repo/ai";
import { videoScriptSchema, type VideoScript } from "@repo/content";
import {
  costSink,
  getArticle,
  getGoSlugForProduct,
  getMediaAssets,
  getSetting,
  loadArticleRenderData,
  notify,
  pathsForArticle,
  publishEnvFromProcess,
  readMediaBlob,
  requestRevalidation,
  recordMediaFile,
  upsertVideo,
  type VideoRow,
} from "@repo/core";
import { urlForKey } from "@repo/media/urls";
import { VIDEO_DIMENSIONS, VIDEO_FPS, youTubeChapters, type VideoInputProps } from "@repo/video";
import { resolvePrompt } from "../prompts";
import type { StepServices } from "../step";
import { buildVideoProps, youTubeDescription } from "./props";
import { generateVideoScript, type VideoKind } from "./script";

export type VideoStage = "all" | "script" | "voice" | "render" | "upload";
export const VIDEO_STAGES = ["all", "script", "voice", "render", "upload"] as const satisfies readonly VideoStage[];

/** Renders props to MP4 + thumbnail JPEGs. The default uses Remotion (@repo/video/render). */
export interface VideoRenderer {
  render(props: VideoInputProps, workDir: string): Promise<{ mp4: Buffer; thumbnails: Buffer[] }>;
}

export interface VideoDeps {
  /** Defaults to ElevenLabs from env (null when no key). */
  tts?: Tts | null;
  /** Defaults to the YouTube uploader from env (null when not configured). */
  youtube?: YouTubeUploader | null;
  renderer?: VideoRenderer;
  /** Inter regular/bold font files for the renderer (the worker resolves @fontsource/inter). */
  fontFiles?: { regular: string; bold: string } | null;
  siteUrl?: string;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

/** The database media driver keeps bytes in Postgres; larger files need R2. */
export const DB_STORAGE_MAX_BYTES = 50 * 1024 * 1024;

export const remotionRenderer: VideoRenderer = {
  async render(props, workDir) {
    const { renderVideo, renderThumbnails } = await import("@repo/video/render");
    const outPath = join(workDir, `${props.kind}.mp4`);
    await renderVideo({ props, outPath });
    const thumbs = await renderThumbnails({ props, outDir: workDir, max: 3 });
    return { mp4: await readFile(outPath), thumbnails: await Promise.all(thumbs.map((t) => readFile(t))) };
  },
};

/**
 * Video pipeline for one article and kind (FR-VID-1..5): script → voice (TTS with word timings)
 * → render (Remotion MP4 + thumbnails) → upload (YouTube). Each stage persists to the `videos`
 * row; re-running a stage clears what later stages produced (the live YouTube id stays until a
 * new upload replaces it). Runs outside review jobs and never blocks publishing.
 */
export async function runVideo(
  services: StepServices,
  opts: { articleId: string; kind: VideoKind; stage: VideoStage },
  deps: VideoDeps = {},
): Promise<VideoRow> {
  const { db } = services;
  const log = deps.log ?? (() => {});
  const article = await getArticle(db, opts.articleId);
  if (!article) throw new Error(`Article ${opts.articleId} not found`);
  let video = await upsertVideo(db, article.id, opts.kind, { error: null });
  const sink = costSink(db, {});
  const onCost: CostHandler = (e) => sink({ ...e, meta: { ...e.meta, videoId: video.id, articleId: article.id } });
  const siteUrl = (deps.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://ai-review.dev").replace(/\/$/, "");
  const articleUrl = `${siteUrl}${articlePath(article.type, article.slug)}`;
  const youtube = deps.youtube === undefined ? createYouTubeUploader() : deps.youtube;
  const stages: Array<Exclude<VideoStage, "all">> =
    opts.stage === "all" ? ["script", "voice", "render", ...(youtube ? (["upload"] as const) : [])] : [opts.stage];

  // Published version for public videos; the current one before first publication.
  const data = await loadArticleRenderData(db, article.id, article.publishedVersionId ?? null);
  if (!data) throw new Error("Article has no content");

  async function store(bytes: Buffer, mimeType: string, ext: string, kind: "video" | "audio" | "image", role: string) {
    if (!services.storage) throw new Error("No media storage configured");
    if (services.storage.kind === "db" && bytes.length > DB_STORAGE_MAX_BYTES) {
      throw new Error(
        `${(bytes.length / 1048576).toFixed(1)} MB is too large for the database media driver; configure R2 (R2_* env)`,
      );
    }
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    const key = `articles/${article!.id}/videos/${opts.kind}-${hash}.${ext}`;
    await services.storage.put(key, bytes, mimeType);
    const { width, height } = VIDEO_DIMENSIONS[opts.kind];
    return recordMediaFile(db, {
      kind,
      origin: "generated",
      storage: services.storage.kind,
      storageKey: key,
      mimeType,
      bytes: bytes.length,
      ...(kind === "audio" ? {} : { width, height }),
      role,
      productId: article!.productId,
      articleId: article!.id,
    });
  }

  /** Reads stored media back (DB driver directly, R2 through its public URL). */
  async function bytesOf(assetId: string) {
    const [asset] = await getMediaAssets(db, [assetId]);
    if (!asset) throw new Error(`Media asset ${assetId} not found`);
    if (asset.storage === "db") {
      const blob = await readMediaBlob(db, asset.storageKey);
      if (!blob) throw new Error(`Media bytes missing for ${asset.storageKey}`);
      return { bytes: blob.bytes, mimeType: blob.mimeType };
    }
    const res = await (services.fetch ?? fetch)(urlForKey("r2", asset.storageKey), {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Media download failed (${asset.storageKey}): HTTP ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: asset.mimeType };
  }

  function requireScript(): VideoScript {
    if (!video.script) throw new Error("No script yet: run the script stage first");
    return videoScriptSchema.parse(video.script);
  }

  try {
    for (const stage of stages) {
      log(`video ${opts.kind}: ${stage}`, { articleId: article.id });
      if (stage === "script") {
        const prompt = await resolvePrompt(db, "video_script");
        const { script, words } = await generateVideoScript(services.makeLlm(onCost), prompt, data, opts.kind);
        log("script generated", { scenes: script.scenes.length, words, promptVersion: prompt.version });
        video = await upsertVideo(db, article.id, opts.kind, {
          script,
          status: "draft",
          audioAssetId: null,
          captions: null,
          videoAssetId: null,
          thumbnailAssetId: null,
          durationSeconds: null,
        });
      }

      if (stage === "voice") {
        const script = requireScript();
        const settings = await getSetting(db, "video.settings");
        const tts = deps.tts === undefined ? createElevenLabsTts({ onCost }) : deps.tts;
        if (!tts) throw new Error("No TTS provider configured (ELEVENLABS_API_KEY)");
        // One continuous take; scenes are cut on word timings (see buildTimeline).
        const speech = await tts.synthesize(script.scenes.map((s) => s.narration).join(" "), {
          voiceId: video.voiceId ?? settings?.voiceId ?? null,
        });
        const audio = await store(speech.audio, speech.mimeType, "mp3", "audio", `video_voice:${opts.kind}`);
        video = await upsertVideo(db, article.id, opts.kind, {
          status: "draft",
          voiceId: speech.voiceId,
          audioAssetId: audio.id,
          captions: speech.words,
          durationSeconds: Math.round(speech.durationMs / 1000),
          videoAssetId: null,
          thumbnailAssetId: null,
        });
      }

      if (stage === "render") {
        const script = requireScript();
        const { audioAssetId, captions } = video;
        if (!audioAssetId || !captions) throw new Error("No voice-over yet: run the voice stage first");
        video = await upsertVideo(db, article.id, opts.kind, { status: "rendering" });
        const { startAssetServer } = await import("@repo/video/render");
        const server = await startAssetServer();
        const workDir = await mkdtemp(join(tmpdir(), "ai-review-video-"));
        try {
          const audio = await bytesOf(audioAssetId);
          const imageIds = [
            ...script.scenes.flatMap((s) => (s.assetId ? [s.assetId] : [])),
            ...(data.product?.logoAssetId ? [data.product.logoAssetId] : []),
          ];
          const images = new Map<string, string>();
          for (const id of new Set(imageIds)) {
            try {
              const img = await bytesOf(id);
              images.set(id, server.add(`img-${id}`, img.bytes, img.mimeType));
            } catch (error) {
              log("image unavailable; scene falls back to text", { assetId: id, error: String(error) });
            }
          }
          const fontUrls = deps.fontFiles
            ? {
                regular: server.add("inter-400.woff", await readFile(deps.fontFiles.regular), "font/woff"),
                bold: server.add("inter-700.woff", await readFile(deps.fontFiles.bold), "font/woff"),
              }
            : null;
          const disclosure = "We may earn a commission if you buy through links in the description.";
          const props = buildVideoProps(
            data,
            script,
            captions,
            {
              imageUrl: (id) => images.get(id) ?? null,
              audioUrl: server.add("voice.mp3", audio.bytes, audio.mimeType),
              audioMs: (video.durationSeconds ?? 0) * 1000,
              fontUrls,
            },
            { articleUrl, disclosure },
          );
          const out = await (deps.renderer ?? remotionRenderer).render(props, workDir);
          const mp4 = await store(out.mp4, "video/mp4", "mp4", "video", `video:${opts.kind}`);
          const thumb = out.thumbnails[0]
            ? await store(out.thumbnails[0], "image/jpeg", "jpg", "image", `video_thumbnail:${opts.kind}`)
            : null;
          video = await upsertVideo(db, article.id, opts.kind, {
            status: "ready",
            videoAssetId: mp4.id,
            thumbnailAssetId: thumb?.id ?? null,
            durationSeconds: Math.round(props.durationInFrames / VIDEO_FPS),
          });
          await notify(db, {
            event: "video.ready",
            title: `Video ready: ${script.title} (${opts.kind})`,
            href: `/articles/${article.id}`,
            entityType: "video",
            entityId: video.id,
          });
        } finally {
          await server.close();
          await rm(workDir, { recursive: true, force: true });
        }
      }

      if (stage === "upload") {
        const script = requireScript();
        if (!video.videoAssetId) throw new Error("No rendered video yet: run the render stage first");
        if (!youtube) throw new Error("YouTube is not configured (YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN)");
        const [settings, aiDisclosure, go] = await Promise.all([
          getSetting(db, "video.settings"),
          getSetting(db, "editorial.aiDisclosure"),
          article.productId ? getGoSlugForProduct(db, article.productId) : null,
        ]);
        const chapters =
          opts.kind === "long"
            ? youTubeChapters(
                buildVideoProps(
                  data,
                  script,
                  video.captions ?? [],
                  { imageUrl: () => null, audioUrl: null, audioMs: null, fontUrls: null },
                  { articleUrl, disclosure: "" },
                ).scenes,
                VIDEO_FPS,
              )
            : [];
        const goUrl = go
          ? `${siteUrl}/go/${encodeURIComponent(go.slug)}?p=yt_${opts.kind}&a=${encodeURIComponent(article.slug)}`
          : null;
        const mp4 = await bytesOf(video.videoAssetId);
        const thumbnail = video.thumbnailAssetId ? await bytesOf(video.thumbnailAssetId) : null;
        const result = await youtube.upload({
          video: mp4.bytes,
          title: script.title,
          description: youTubeDescription({
            script,
            articleUrl,
            goUrl,
            productName: data.product?.name ?? article.title,
            aiDisclosure: aiDisclosure ?? null,
            chapters,
          }),
          tags: script.tags,
          privacyStatus: settings?.youtubePrivacy ?? "private",
          thumbnail,
        });
        log("uploaded to YouTube", { videoId: result.videoId, thumbnailSet: result.thumbnailSet });
        video = await upsertVideo(db, article.id, opts.kind, {
          status: "published",
          youtubeId: result.videoId,
          publishedAt: new Date(),
        });
        // Show the embed and VideoObject without waiting for ISR (never fails the upload).
        if (article.publishedVersionId) {
          await requestRevalidation(publishEnvFromProcess(), { paths: await pathsForArticle(db, article.id) }).catch(
            () => null,
          );
        }
      }
    }
    return video;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    video = await upsertVideo(db, article.id, opts.kind, { status: "failed", error: message.slice(0, 2000) });
    await notify(db, {
      event: "video.failed",
      title: `Video failed: ${article.title} (${opts.kind})`,
      body: message.slice(0, 1000),
      href: `/articles/${article.id}`,
      entityType: "video",
      entityId: video.id,
    });
    throw error;
  }
}
