import { createRequire } from "node:module";
import { articlesNeedingVideos, getSetting } from "@repo/core";
import { getDb } from "@repo/db";
import { createStepServices, runVideo, VIDEO_STAGES } from "@repo/pipeline";
import { logger, queue, schedules, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

const require = createRequire(import.meta.url);

/** Inter for the renderer: Linux render hosts have almost no fonts installed. */
function fontFiles() {
  try {
    return {
      regular: require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff"),
      bold: require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff"),
    };
  } catch {
    return null;
  }
}

/** Renders are CPU-heavy: one at a time on a large machine. */
const videoQueue = queue({ name: "video", concurrencyLimit: 1 });

/**
 * Video pipeline for one article (FR-VID-1..5). The CMS triggers single stages ("Regenerate
 * voice" etc., FR-VID-5); auto-generation runs "all". Retries resume the failed stage only.
 */
export const generateVideo = schemaTask({
  id: "generate-video",
  schema: z.object({
    articleId: z.uuid(),
    kind: z.enum(["short", "long"]),
    stage: z.enum(VIDEO_STAGES).default("all"),
  }),
  queue: videoQueue,
  machine: "large-1x",
  maxDuration: 3600,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    const video = await runVideo(createStepServices(getDb()), payload, {
      fontFiles: fontFiles(),
      log: (message, data) => logger.info(message, data),
    });
    return { videoId: video.id, status: video.status, youtubeId: video.youtubeId };
  },
});

/** Hourly: generate videos for newly published articles when enabled in Settings (FR-VID-1). */
export const videoAutogen = schedules.task({
  id: "video-autogen",
  cron: "23 * * * *",
  run: async () => {
    const db = getDb();
    const [enabled, settings] = await Promise.all([
      getSetting(db, "pipeline.videoEnabled"),
      getSetting(db, "video.settings"),
    ]);
    if (!enabled || !settings?.autoGenerate) return { queued: 0, reason: "disabled" };
    const todo = await articlesNeedingVideos(db, settings.kinds, 2);
    for (const item of todo) {
      await generateVideo.trigger({ ...item, stage: "all" }, { tags: [`article_${item.articleId}`] });
    }
    logger.info("video autogen", { queued: todo.length });
    return { queued: todo.length };
  },
});
