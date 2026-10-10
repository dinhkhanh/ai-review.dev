"use server";

import { videoScriptSchema } from "@repo/content";
import { getArticle, recordAudit, upsertVideo } from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../../../lib/auth";
import { triggerTask } from "../../../lib/dispatch";

type State = { ok: boolean; message: string } | null;

const stageSchema = z.object({
  articleId: z.uuid(),
  kind: z.enum(["short", "long"]),
  stage: z.enum(["all", "script", "voice", "render", "upload"]),
});

const STAGE_LABEL = {
  all: "Full video",
  script: "Script",
  voice: "Voice-over",
  render: "Render",
  upload: "YouTube upload",
} as const;

/** Queues one video stage on the worker (FR-VID-5: regenerate script, voice or render individually). */
export async function runVideoStageAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireUser();
  const parsed = stageSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Invalid request" };
  const { articleId, kind, stage } = parsed.data;
  const db = getDb();
  if (!(await getArticle(db, articleId))) return { ok: false, message: "Article not found" };
  const result = await triggerTask("generate-video", { articleId, kind, stage }, { tags: [`article_${articleId}`] });
  if (!result.ok) {
    return {
      ok: false,
      message: `Could not start the worker: ${result.reason}. Locally run: pnpm --filter worker video ${articleId} ${kind} ${stage}`,
    };
  }
  await recordAudit(db, {
    actorUserId: user.id,
    action: `video.${stage}`,
    entityType: "article",
    entityId: articleId,
    data: { kind, runId: result.runId },
  });
  revalidatePath(`/articles/${articleId}`);
  return { ok: true, message: `${STAGE_LABEL[stage]} queued for the ${kind} video. Refresh in a minute.` };
}

/**
 * Saves an edited script (FR-VID-5). A new script makes the voice-over and render stale, so they
 * are cleared; the live YouTube video stays until a new upload replaces it.
 */
export async function saveVideoScriptAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireUser();
  const articleId = String(form.get("articleId") ?? "");
  const kind = z.enum(["short", "long"]).safeParse(form.get("kind"));
  if (!kind.success) return { ok: false, message: "Invalid video kind" };
  let script;
  try {
    script = videoScriptSchema.parse({ ...JSON.parse(String(form.get("script") ?? "")), kind: kind.data });
  } catch (error) {
    return { ok: false, message: `Script is not valid: ${String(error).slice(0, 300)}` };
  }
  const db = getDb();
  await upsertVideo(db, articleId, kind.data, {
    script,
    status: "draft",
    error: null,
    audioAssetId: null,
    captions: null,
    videoAssetId: null,
    thumbnailAssetId: null,
    durationSeconds: null,
  });
  await recordAudit(db, {
    actorUserId: user.id,
    action: "video.script_edit",
    entityType: "article",
    entityId: articleId,
    data: { kind: kind.data },
  });
  revalidatePath(`/articles/${articleId}`);
  return { ok: true, message: "Script saved. Regenerate the voice-over next." };
}
