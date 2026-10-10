import { confirmNewsletter } from "@repo/core";
import { getDb } from "@repo/db";
import type { NextRequest } from "next/server";

/** Confirms a subscription from the button on /newsletter/confirm (POST, so link scanners can't). */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const ok = await confirmNewsletter(getDb(), String(form.get("token") ?? "").slice(0, 100));
  return Response.redirect(new URL(`/newsletter/confirm?status=${ok ? "confirmed" : "invalid"}`, request.url), 303);
}
