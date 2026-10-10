import { newsletterLocale, unsubscribeNewsletter } from "@repo/core";
import { localePath } from "@repo/content";
import { getDb } from "@repo/db";
import type { NextRequest } from "next/server";

/**
 * Unsubscribes from the button on /newsletter/unsubscribe, or from a mail client's one-click
 * request (RFC 8058): the digest's `List-Unsubscribe` header points here with `?token=` and the
 * client POSTs `List-Unsubscribe=One-Click`; that gets a plain 200, never a redirect.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => new FormData());
  const queryToken = request.nextUrl.searchParams.get("token");
  const token = String(form.get("token") ?? queryToken ?? "").slice(0, 100);
  const ok = await unsubscribeNewsletter(getDb(), token);
  if (form.get("List-Unsubscribe") === "One-Click" || (queryToken && !form.has("token"))) {
    return new Response(ok ? "Unsubscribed" : "Unknown token", {
      status: ok ? 200 : 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const page = localePath(newsletterLocale(form.get("locale")), "/newsletter/unsubscribe");
  return Response.redirect(new URL(`${page}?status=${ok ? "done" : "invalid"}`, request.url), 303);
}
