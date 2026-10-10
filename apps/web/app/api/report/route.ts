import { createErrorReport, getArticleIdBySlug } from "@repo/core";
import { getDb } from "@repo/db";
import type { NextRequest } from "next/server";
import { guardForm } from "../../../lib/visitor";

/**
 * "Report a change" (FR-WEB-6): plain HTML form post, no JavaScript needed. A honeypot field and
 * length limits keep it cheap to abuse-proof; reports appear in the CMS for a refresh.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  if (String(form.get("website") ?? "")) return Response.redirect(new URL("/report/thanks", request.url), 303);
  const articleSlug = String(form.get("article") ?? "").slice(0, 120);
  const message = String(form.get("message") ?? "");
  const email = String(form.get("email") ?? "") || null;
  const kind = String(form.get("kind") ?? "pricing");
  // Rate limit + Turnstile (FR-API-3, NFR-7).
  const guard = await guardForm(request, form, "report");
  if (!guard.ok) {
    return Response.redirect(new URL(`/report?article=${encodeURIComponent(articleSlug)}&error=1`, request.url), 303);
  }
  try {
    const db = getDb();
    await createErrorReport(db, {
      articleId: articleSlug ? await getArticleIdBySlug(db, articleSlug) : null,
      kind: ["pricing", "error", "other"].includes(kind) ? kind : "other",
      message,
      email,
    });
  } catch {
    return Response.redirect(new URL(`/report?article=${encodeURIComponent(articleSlug)}&error=1`, request.url), 303);
  }
  return Response.redirect(new URL("/report/thanks", request.url), 303);
}
