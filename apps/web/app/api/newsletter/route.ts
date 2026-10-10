import { DomainError, newsletterLocale, subscribeNewsletter } from "@repo/core";
import { localePath } from "@repo/content";
import { getDb } from "@repo/db";
import type { NextRequest } from "next/server";
import { guardForm } from "../../../lib/visitor";

/**
 * Newsletter sign-up (FR-API-3, double opt-in). Always lands on the same "check your inbox" page so
 * the response never reveals whether an address is already subscribed. The form's `locale` field
 * (en/de) picks the language of the confirmation email and the weekly digest (FR-WEB-9).
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const locale = newsletterLocale(form.get("locale"));
  const thanksUrl = (query = "") => new URL(`${localePath(locale, "/newsletter/thanks")}${query}`, request.url);
  if (String(form.get("website") ?? "")) return Response.redirect(thanksUrl(), 303);
  const guard = await guardForm(request, form, "newsletter");
  if (!guard.ok) return Response.redirect(thanksUrl("?error=retry"), 303);
  try {
    await subscribeNewsletter(getDb(), { email: String(form.get("email") ?? ""), source: "web", locale });
  } catch (error) {
    if (error instanceof DomainError) return Response.redirect(thanksUrl("?error=email"), 303);
    throw error;
  }
  return Response.redirect(thanksUrl(), 303);
}
