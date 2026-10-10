import { randomBytes } from "node:crypto";
import { eq, newsletterSubscribers, type DbOrTx } from "@repo/db";
import { z } from "zod";
import { DomainError } from "./errors";
import { sendEmail, type NotifyEnv } from "./notifications";

/**
 * Newsletter sign-up with double opt-in (FR-API-3; the digest itself is FR-WEB-9, phase 3).
 * Responses never reveal whether an address is already subscribed.
 */

/** Minimum gap between confirmation emails to the same address. */
export const CONFIRM_RESEND_COOLDOWN_MS = 10 * 60 * 1000;
/** Confirmation links expire; the token keeps working for unsubscribe. */
export const CONFIRM_TTL_MS = 7 * 24 * 3600 * 1000;

export interface NewsletterEnv extends Pick<NotifyEnv, "resendApiKey" | "emailFrom"> {
  siteUrl: string;
  siteName?: string;
}

export function newsletterEnvFromProcess(env: NodeJS.ProcessEnv = process.env): NewsletterEnv {
  return {
    resendApiKey: env.RESEND_API_KEY ?? null,
    emailFrom: env.NOTIFY_EMAIL_FROM ?? null,
    siteUrl: (env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  };
}

const emailSchema = z.email().max(200);

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) throw new DomainError("invalid", "Enter a valid email address");
  return email;
}

const newToken = () => randomBytes(24).toString("base64url");

function confirmationEmail(env: NewsletterEnv, token: string) {
  const name = env.siteName ?? "AI Review";
  const confirm = `${env.siteUrl}/newsletter/confirm?token=${encodeURIComponent(token)}`;
  const unsubscribe = `${env.siteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
  return {
    subject: `Confirm your ${name} subscription`,
    text: [
      `Please confirm that you want ${name}'s weekly email with new and updated reviews:`,
      confirm,
      "",
      "If you did not sign up, ignore this email and nothing will happen.",
      `Unsubscribe at any time: ${unsubscribe}`,
    ].join("\n"),
  };
}

/**
 * Starts (or restarts) a subscription and emails a confirmation link. Already-confirmed addresses
 * get no email; pending ones get at most one email per cooldown. Returns what happened, for tests
 * and logs only; callers must show the same message in every case.
 */
export async function subscribeNewsletter(
  db: DbOrTx,
  input: { email: string; source?: string | null },
  opts: { env?: NewsletterEnv; now?: Date; fetch?: typeof fetch } = {},
): Promise<"sent" | "already_confirmed" | "cooldown" | "not_sent"> {
  const env = opts.env ?? newsletterEnvFromProcess();
  const now = opts.now ?? new Date();
  const email = normalizeEmail(input.email);
  const [existing] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email))
    .limit(1);
  if (existing?.confirmedAt && !existing.unsubscribedAt) return "already_confirmed";
  if (
    existing?.tokenSentAt &&
    !existing.unsubscribedAt &&
    now.getTime() - existing.tokenSentAt.getTime() < CONFIRM_RESEND_COOLDOWN_MS
  ) {
    return "cooldown";
  }
  const token = newToken();
  if (existing) {
    await db
      .update(newsletterSubscribers)
      .set({ token, tokenSentAt: now, confirmedAt: null, unsubscribedAt: null })
      .where(eq(newsletterSubscribers.id, existing.id));
  } else {
    await db
      .insert(newsletterSubscribers)
      .values({ email, token, tokenSentAt: now, source: input.source?.slice(0, 60) ?? null });
  }
  const result = await sendEmail(env, { to: [email], ...confirmationEmail(env, token) }, opts.fetch);
  return result === "sent" ? "sent" : "not_sent";
}

/** Confirms the subscription for a token sent within the TTL. */
export async function confirmNewsletter(db: DbOrTx, token: string, now = new Date()): Promise<boolean> {
  if (!token) return false;
  const [row] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.token, token)).limit(1);
  if (!row) return false;
  if (row.confirmedAt && !row.unsubscribedAt) return true;
  if (!row.tokenSentAt || now.getTime() - row.tokenSentAt.getTime() > CONFIRM_TTL_MS) return false;
  await db
    .update(newsletterSubscribers)
    .set({ confirmedAt: now, unsubscribedAt: null })
    .where(eq(newsletterSubscribers.id, row.id));
  return true;
}

/** Unsubscribes the address behind a token. Unknown tokens return false. */
export async function unsubscribeNewsletter(db: DbOrTx, token: string, now = new Date()): Promise<boolean> {
  if (!token) return false;
  const rows = await db
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: now })
    .where(eq(newsletterSubscribers.token, token))
    .returning({ id: newsletterSubscribers.id });
  return rows.length > 0;
}
