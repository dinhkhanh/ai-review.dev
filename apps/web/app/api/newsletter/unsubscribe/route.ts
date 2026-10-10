import { unsubscribeNewsletter } from "@repo/core";
import { getDb } from "@repo/db";
import type { NextRequest } from "next/server";

/** Unsubscribes from the button on /newsletter/unsubscribe. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const ok = await unsubscribeNewsletter(getDb(), String(form.get("token") ?? "").slice(0, 100));
  return Response.redirect(new URL(`/newsletter/unsubscribe?status=${ok ? "done" : "invalid"}`, request.url), 303);
}
