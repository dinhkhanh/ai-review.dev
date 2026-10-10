"use server";

import { costSink, publishEnvFromProcess, recordAudit } from "@repo/core";
import { getDb } from "@repo/db";
import { generateSocialSnippets, resolvePrompt } from "@repo/pipeline/editor";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";
import { cmsServices } from "../../../lib/services";

/** Regenerates the X / LinkedIn / Threads posts for an article (FR-CON-8). */
export async function regenerateSocialAction(
  _prev: { ok: boolean; message: string } | null,
  form: FormData,
): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  const db = getDb();
  try {
    const prompt = await resolvePrompt(db, "social");
    await generateSocialSnippets(
      { db, llm: cmsServices().makeLlm(costSink(db, {})), prompt, siteUrl: publishEnvFromProcess().siteUrl },
      articleId,
    );
  } catch (error) {
    return { ok: false, message: `Could not generate posts: ${String(error).slice(0, 200)}` };
  }
  await recordAudit(db, { actorUserId: user.id, action: "article.social", entityType: "article", entityId: articleId });
  revalidatePath(`/articles/${articleId}`);
  return { ok: true, message: "Posts regenerated." };
}
