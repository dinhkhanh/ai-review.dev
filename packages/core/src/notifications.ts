import { and, count, desc, eq, inArray, isNull, notifications, sql, type DbOrTx } from "@repo/db";
import { getSetting } from "./settings";

type Severity = (typeof notifications.severity.enumValues)[number];

/**
 * Notification events (FR-CMS-8) with default channels. Settings key `notifications.events`
 * overrides the channels per event; every notification also lands in the CMS inbox.
 */
export const NOTIFICATION_EVENTS = {
  "job.succeeded": { label: "Job completed", severity: "success", email: false, webhook: true },
  "job.failed": { label: "Job or step failed", severity: "error", email: true, webhook: true },
  "job.awaiting_approval": { label: "Job paused at its cost ceiling", severity: "warning", email: true, webhook: true },
  "article.awaiting_review": { label: "Article awaiting review", severity: "info", email: true, webhook: true },
  "article.auto_published": { label: "Article auto-published", severity: "success", email: false, webhook: true },
  "refresh.changes": { label: "Refresh found fact changes", severity: "info", email: true, webhook: true },
  "product.discontinued": { label: "Product looks discontinued", severity: "warning", email: true, webhook: true },
  "link.broken": { label: "Affiliate link broken", severity: "error", email: true, webhook: true },
  "program.reminder": { label: "Affiliate program status reminder", severity: "info", email: true, webhook: false },
  "cost.alert": { label: "Cost above target", severity: "warning", email: true, webhook: true },
  "conversions.imported": { label: "Conversions imported", severity: "info", email: false, webhook: false },
  "sourcing.suggestions": { label: "New suggested products", severity: "info", email: false, webhook: true },
  "video.ready": { label: "Video ready", severity: "success", email: false, webhook: true },
  "video.failed": { label: "Video failed", severity: "error", email: true, webhook: true },
} as const satisfies Record<string, { label: string; severity: Severity; email: boolean; webhook: boolean }>;
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

export interface NotifyEnv {
  resendApiKey?: string | null;
  emailFrom?: string | null;
  /** Slack-compatible incoming webhook ({ text }). */
  webhookUrl?: string | null;
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
  cmsUrl?: string | null;
}

export function notifyEnvFromProcess(env: NodeJS.ProcessEnv = process.env): NotifyEnv {
  return {
    resendApiKey: env.RESEND_API_KEY ?? null,
    emailFrom: env.NOTIFY_EMAIL_FROM ?? null,
    webhookUrl: env.NOTIFY_WEBHOOK_URL ?? null,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? null,
    telegramChatId: env.TELEGRAM_CHAT_ID ?? null,
    cmsUrl: env.NEXT_PUBLIC_CMS_URL ?? null,
  };
}

/** Sends one email through Resend's REST API. Returns "sent" or an error string; never throws. */
export async function sendEmail(
  env: Pick<NotifyEnv, "resendApiKey" | "emailFrom">,
  message: { to: string[]; subject: string; text: string; html?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!env.resendApiKey || !env.emailFrom) return "skipped: RESEND_API_KEY or NOTIFY_EMAIL_FROM not set";
  if (message.to.length === 0) return "skipped: no recipients";
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.emailFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "sent" : `error: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
  } catch (error) {
    return `error: ${String(error).slice(0, 200)}`;
  }
}

async function postWebhooks(env: NotifyEnv, text: string, fetchImpl: typeof fetch): Promise<string> {
  const results: string[] = [];
  if (env.webhookUrl) {
    try {
      const res = await fetchImpl(env.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10_000),
      });
      results.push(res.ok ? "webhook sent" : `webhook error: HTTP ${res.status}`);
    } catch (error) {
      results.push(`webhook error: ${String(error).slice(0, 100)}`);
    }
  }
  if (env.telegramBotToken && env.telegramChatId) {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.telegramChatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      results.push(res.ok ? "telegram sent" : `telegram error: HTTP ${res.status}`);
    } catch (error) {
      results.push(`telegram error: ${String(error).slice(0, 100)}`);
    }
  }
  return results.join("; ") || "skipped: no webhook configured";
}

export interface NotifyInput {
  event: NotificationEvent;
  title: string;
  body?: string | null;
  /** CMS path, e.g. `/jobs/<id>`. */
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Same key = same notification; repeats are dropped (e.g. `link.broken:<id>:<day>`). */
  dedupeKey?: string | null;
  severity?: Severity;
}

/**
 * Records a notification for the CMS inbox and delivers it by email and webhook according to the
 * per-event settings (FR-CMS-8). Never throws: delivery problems are stored on the row.
 * Returns the row, or null when the dedupe key was already used.
 */
export async function notify(db: DbOrTx, input: NotifyInput, opts: { env?: NotifyEnv; fetch?: typeof fetch } = {}) {
  const env = opts.env ?? notifyEnvFromProcess();
  const fetchImpl = opts.fetch ?? fetch;
  const def = NOTIFICATION_EVENTS[input.event];
  try {
    const [row] = await db
      .insert(notifications)
      .values({
        event: input.event,
        severity: input.severity ?? def.severity,
        title: input.title.slice(0, 300),
        body: input.body?.slice(0, 4000) ?? null,
        href: input.href ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning();
    if (!row) return null;

    const [overrides, recipients] = await Promise.all([
      getSetting(db, "notifications.events"),
      getSetting(db, "notifications.recipients"),
    ]);
    const channels = overrides?.[input.event] ?? { email: def.email, webhook: def.webhook };
    const link = input.href && env.cmsUrl ? `${env.cmsUrl.replace(/\/$/, "")}${input.href}` : null;
    const text = [input.title, input.body, link].filter(Boolean).join("\n\n");
    const delivery: Record<string, string> = {};
    if (channels.email) {
      delivery.email = await sendEmail(
        env,
        { to: recipients ?? [], subject: `[AI Review] ${input.title}`.slice(0, 200), text },
        fetchImpl,
      );
    }
    if (channels.webhook) delivery.webhook = await postWebhooks(env, text, fetchImpl);
    if (Object.keys(delivery).length) {
      await db.update(notifications).set({ delivery }).where(eq(notifications.id, row.id));
    }
    return { ...row, delivery };
  } catch (error) {
    console.error("notify failed", input.event, error);
    return null;
  }
}

export async function listNotifications(db: DbOrTx, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  return db
    .select()
    .from(notifications)
    .where(opts.unreadOnly ? isNull(notifications.readAt) : undefined)
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
}

export async function unreadNotificationCount(db: DbOrTx) {
  const [row] = await db.select({ n: count() }).from(notifications).where(isNull(notifications.readAt));
  return row?.n ?? 0;
}

export async function markNotificationsRead(db: DbOrTx, ids?: string[]) {
  await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(isNull(notifications.readAt), ids?.length ? inArray(notifications.id, ids) : undefined));
}
