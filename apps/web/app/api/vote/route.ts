import { isContentLocale } from "@repo/content";
import { getLiveArticleIdBySlug, recordHelpfulVote } from "@repo/core";
import { getDb } from "@repo/db";
import type { NextRequest } from "next/server";
import { guardForm, safeReturnPath, wantsJson } from "../../../lib/visitor";

/**
 * "Was this helpful?" (FR-WEB-10). Form post without JS (redirects back), JSON with fetch. One vote
 * per daily-hashed IP per article per day; voting again changes it.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const json = wantsJson(request);
  const back = safeReturnPath(form.get("return"));
  const reply = (status: number, message: string) =>
    json
      ? Response.json({ ok: status < 300, message }, { status })
      : Response.redirect(new URL(`${back}${status < 300 ? "?voted=1" : ""}#helpful-label`, request.url), 303);

  const guard = await guardForm(request, form, "vote");
  if (!guard.ok) return reply(guard.status, guard.message);
  const helpful = form.get("helpful");
  if (helpful !== "yes" && helpful !== "no") return reply(400, "Invalid vote");
  const db = getDb();
  // Slugs are unique per locale; the form posts the page locale.
  const locale = form.get("locale");
  const articleId = await getLiveArticleIdBySlug(
    db,
    String(form.get("article") ?? "").slice(0, 120),
    isContentLocale(locale) ? locale : null,
  );
  if (!articleId) return reply(404, "Article not found");
  await recordHelpfulVote(db, { articleId, helpful: helpful === "yes", ipHash: guard.ipHash });
  return reply(202, "Thanks for the feedback");
}
