import { DomainError, subscribeNewsletter } from "@repo/core";
import { getDb } from "@repo/db";
import type { NextRequest } from "next/server";
import { guardForm } from "../../../lib/visitor";

/**
 * Newsletter sign-up (FR-API-3, double opt-in). Always lands on the same "check your inbox" page so
 * the response never reveals whether an address is already subscribed.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const thanks = new URL("/newsletter/thanks", request.url);
  if (String(form.get("website") ?? "")) return Response.redirect(thanks, 303);
  const guard = await guardForm(request, form, "newsletter");
  if (!guard.ok) return Response.redirect(new URL("/newsletter/thanks?error=retry", request.url), 303);
  try {
    await subscribeNewsletter(getDb(), { email: String(form.get("email") ?? ""), source: "web" });
  } catch (error) {
    if (error instanceof DomainError)
      return Response.redirect(new URL("/newsletter/thanks?error=email", request.url), 303);
    throw error;
  }
  return Response.redirect(thanks, 303);
}
