import { localizedArticlePath } from "@repo/content";
import {
  and,
  devices,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  priceAlerts,
  priceChanges,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { describePriceChanges, pushTargetsForProduct, type DeviceLocale, type PriceChangeLine } from "./devices";
import { getSetting } from "./settings";

/**
 * Mobile push via the Expo Push API (FR-API-4). Sending returns tickets; delivery receipts are
 * available ~15 minutes later and are checked by a delayed worker run (`checkPushReceipts`).
 */

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo accepts at most 100 messages per send request and 1000 ids per receipts request. */
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 1000;
/** Price changes older than this are marked handled without a push (stale news). */
const STALE_AFTER_MS = 3 * 24 * 3600_000;

export interface PushEnv {
  /** Required only when "enhanced push security" is enabled for the Expo project. */
  accessToken?: string | null;
  siteUrl: string;
}

export function pushEnvFromProcess(env: NodeJS.ProcessEnv = process.env): PushEnv {
  return {
    accessToken: env.EXPO_ACCESS_TOKEN || null,
    siteUrl: (env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  };
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  channelId?: string;
}

export type ExpoTicket =
  { status: "ok"; id: string } | { status: "error"; message: string; details?: { error?: string } };

export type ExpoReceipt = { status: "ok" } | { status: "error"; message: string; details?: { error?: string } };

function headers(env: Pick<PushEnv, "accessToken">) {
  return {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
    ...(env.accessToken ? { Authorization: `Bearer ${env.accessToken}` } : {}),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sends messages in chunks of 100. Returns one ticket per message, in order; a failed request
 * yields error tickets for its chunk rather than throwing, so one bad chunk never stops the rest.
 */
export async function sendExpoPush(
  messages: ExpoPushMessage[],
  opts: { env?: Pick<PushEnv, "accessToken">; fetch?: typeof fetch } = {},
): Promise<ExpoTicket[]> {
  const env = opts.env ?? pushEnvFromProcess();
  const tickets: ExpoTicket[] = [];
  for (const part of chunk(messages, SEND_CHUNK)) {
    try {
      const res = await (opts.fetch ?? fetch)(EXPO_SEND_URL, {
        method: "POST",
        headers: headers(env),
        body: JSON.stringify(part),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: ExpoTicket[]; errors?: Array<{ message: string }> };
      if (!res.ok || !Array.isArray(json.data)) {
        const message = json.errors?.[0]?.message ?? `HTTP ${res.status}`;
        tickets.push(...part.map(() => ({ status: "error" as const, message })));
      } else {
        tickets.push(...part.map((_, i) => json.data![i] ?? { status: "error" as const, message: "missing ticket" }));
      }
    } catch (error) {
      tickets.push(...part.map(() => ({ status: "error" as const, message: String(error).slice(0, 200) })));
    }
  }
  return tickets;
}

export async function getExpoReceipts(
  ids: string[],
  opts: { env?: Pick<PushEnv, "accessToken">; fetch?: typeof fetch } = {},
): Promise<Record<string, ExpoReceipt>> {
  const env = opts.env ?? pushEnvFromProcess();
  const receipts: Record<string, ExpoReceipt> = {};
  for (const part of chunk(ids, RECEIPT_CHUNK)) {
    const res = await (opts.fetch ?? fetch)(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: headers(env),
      body: JSON.stringify({ ids: part }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Expo receipts failed: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Record<string, ExpoReceipt> };
    Object.assign(receipts, json.data ?? {});
  }
  return receipts;
}

/** Stops pushing to devices Expo says are gone (app uninstalled or token revoked). */
async function disablePush(db: DbOrTx, deviceIds: string[], now = new Date()) {
  if (deviceIds.length === 0) return;
  await db.update(devices).set({ pushToken: null, disabledAt: now }).where(inArray(devices.id, deviceIds));
}

const isDeviceGone = (r: { status: string; details?: { error?: string } }) =>
  r.status === "error" && r.details?.error === "DeviceNotRegistered";

/** Deep link into the app plus the universal (https) link for the same review. */
export function reviewLinks(siteUrl: string, reviewSlug: string, locale: DeviceLocale) {
  return {
    url: `aireview://reviews/${encodeURIComponent(reviewSlug)}${locale === "de" ? "?locale=de" : ""}`,
    webUrl: `${siteUrl}${localizedArticlePath("review", reviewSlug, locale)}`,
  };
}

export function priceChangeMessage(input: {
  to: string;
  locale: DeviceLocale;
  productName: string;
  productSlug: string;
  reviewSlug: string | null;
  lines: PriceChangeLine[];
  siteUrl: string;
  priceChangeId: string;
}): ExpoPushMessage {
  const de = input.locale === "de";
  const links = input.reviewSlug ? reviewLinks(input.siteUrl, input.reviewSlug, input.locale) : null;
  return {
    to: input.to,
    title: de ? `Preisänderung bei ${input.productName}` : `${input.productName} changed its pricing`,
    body: describePriceChanges(input.lines, input.locale),
    sound: "default",
    channelId: "price-alerts",
    data: {
      kind: "price_change",
      priceChangeId: input.priceChangeId,
      product: input.productSlug,
      ...(links ?? {}),
    },
  };
}

export interface PushTicketRef {
  ticketId: string;
  deviceId: string;
}

export interface SendPriceAlertsResult {
  changes: number;
  sent: number;
  failed: number;
  capped: number;
  /** Ok tickets to check for receipts later. */
  tickets: PushTicketRef[];
  skipped?: "disabled";
}

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * Pushes pending price changes to subscribed devices (FR-API-4). Each change is claimed atomically
 * (`notified_at` set before sending) so overlapping runs never double-send. The daily per-device cap
 * counts today's already-notified changes for products the device follows.
 */
export async function sendPendingPriceAlerts(
  db: DbOrTx,
  opts: { env?: PushEnv; fetch?: typeof fetch; now?: Date; limit?: number } = {},
): Promise<SendPriceAlertsResult> {
  const env = opts.env ?? pushEnvFromProcess();
  const now = opts.now ?? new Date();
  const result: SendPriceAlertsResult = { changes: 0, sent: 0, failed: 0, capped: 0, tickets: [] };
  const policy = (await getSetting(db, "mobile.push")) ?? { priceAlerts: true, maxPerDevicePerDay: 3 };
  if (!policy.priceAlerts) return { ...result, skipped: "disabled" };

  // Stale changes are marked handled so they never surface days later.
  await db
    .update(priceChanges)
    .set({ notifiedAt: now })
    .where(and(isNull(priceChanges.notifiedAt), lt(priceChanges.detectedAt, new Date(now.getTime() - STALE_AFTER_MS))));

  const pending = await db
    .select({ id: priceChanges.id })
    .from(priceChanges)
    .where(isNull(priceChanges.notifiedAt))
    .orderBy(priceChanges.detectedAt)
    .limit(opts.limit ?? 20);

  const dayStart = startOfUtcDay(now);
  for (const { id } of pending) {
    const [claimed] = await db
      .update(priceChanges)
      .set({ notifiedAt: now })
      .where(and(eq(priceChanges.id, id), isNull(priceChanges.notifiedAt)))
      .returning();
    if (!claimed) continue;
    result.changes += 1;

    const [product] = await db
      .select({
        name: products.name,
        slug: products.slug,
        // Literal names: single-table selects render columns unqualified, which breaks correlation.
        reviewSlug: sql<string | null>`(
          select a.slug from articles a
          where a.product_id = "products"."id" and a.type = 'review' and a.locale = 'en'
            and a.published_version_id is not null and a.status <> 'archived'
          limit 1)`,
      })
      .from(products)
      .where(eq(products.id, claimed.productId))
      .limit(1);
    if (!product) continue;

    const targets = await pushTargetsForProduct(db, claimed.productId);
    const sentToday = targets.length
      ? await db
          .select({ deviceId: priceAlerts.deviceId, n: sql<number>`count(*)::int` })
          .from(priceAlerts)
          .innerJoin(priceChanges, eq(priceChanges.productId, priceAlerts.productId))
          .where(
            and(
              inArray(
                priceAlerts.deviceId,
                targets.map((t) => t.deviceId),
              ),
              gte(priceChanges.notifiedAt, dayStart),
              gt(priceChanges.pushSent, 0),
            ),
          )
          .groupBy(priceAlerts.deviceId)
      : [];
    const counts = new Map(sentToday.map((r) => [r.deviceId, r.n]));
    const eligible = targets.filter((t) => (counts.get(t.deviceId) ?? 0) < policy.maxPerDevicePerDay);
    result.capped += targets.length - eligible.length;

    const lines = claimed.changes as unknown as PriceChangeLine[];
    const messages = eligible.map((t) =>
      priceChangeMessage({
        to: t.pushToken!,
        locale: t.locale === "de" ? "de" : "en",
        productName: product.name,
        productSlug: product.slug,
        reviewSlug: product.reviewSlug,
        lines,
        siteUrl: env.siteUrl,
        priceChangeId: claimed.id,
      }),
    );
    const tickets = messages.length ? await sendExpoPush(messages, { env, fetch: opts.fetch }) : [];
    let sent = 0;
    let failed = 0;
    const gone: string[] = [];
    tickets.forEach((ticket, i) => {
      const deviceId = eligible[i]!.deviceId;
      if (ticket.status === "ok") {
        sent += 1;
        result.tickets.push({ ticketId: ticket.id, deviceId });
      } else {
        failed += 1;
        if (isDeviceGone(ticket)) gone.push(deviceId);
      }
    });
    await disablePush(db, gone, now);
    await db.update(priceChanges).set({ pushSent: sent, pushFailed: failed }).where(eq(priceChanges.id, claimed.id));
    result.sent += sent;
    result.failed += failed;
  }
  return result;
}

/** Reads delivery receipts for earlier tickets and disables devices that are no longer registered. */
export async function checkPushReceipts(
  db: DbOrTx,
  tickets: PushTicketRef[],
  opts: { env?: Pick<PushEnv, "accessToken">; fetch?: typeof fetch } = {},
): Promise<{ ok: number; errors: number; disabled: number; pending: number }> {
  if (tickets.length === 0) return { ok: 0, errors: 0, disabled: 0, pending: 0 };
  const receipts = await getExpoReceipts(
    tickets.map((t) => t.ticketId),
    opts,
  );
  let ok = 0;
  let errors = 0;
  let pending = 0;
  const gone = new Set<string>();
  for (const t of tickets) {
    const r = receipts[t.ticketId];
    if (!r) pending += 1;
    else if (r.status === "ok") ok += 1;
    else {
      errors += 1;
      if (isDeviceGone(r)) gone.add(t.deviceId);
    }
  }
  await disablePush(db, [...gone]);
  return { ok, errors, disabled: gone.size, pending };
}
