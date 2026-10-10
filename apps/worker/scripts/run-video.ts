import { createRequire } from "node:module";
import { getDb } from "@repo/db";
import { createStepServices, runVideo, VIDEO_STAGES, type VideoStage } from "@repo/pipeline";

/**
 * Local video runner (no Trigger.dev needed, FR-VID-5):
 *   pnpm --filter worker video <articleId> [short|long] [all|script|voice|render|upload]
 */
const [articleId, kind = "short", stage = "all"] = process.argv.slice(2);
if (!articleId || !["short", "long"].includes(kind) || !(VIDEO_STAGES as readonly string[]).includes(stage)) {
  console.error("Usage: pnpm --filter worker video <articleId> [short|long] [all|script|voice|render|upload]");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const video = await runVideo(
  createStepServices(getDb()),
  { articleId, kind: kind as "short" | "long", stage: stage as VideoStage },
  {
    fontFiles: {
      regular: require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff"),
      bold: require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff"),
    },
    log: (message, data) => console.log(message, data ? JSON.stringify(data).slice(0, 300) : ""),
  },
);
console.log(JSON.stringify({ id: video.id, status: video.status, youtubeId: video.youtubeId, error: video.error }));
process.exit(0);
