import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { localizedArticlePath, type FactSheet } from "@repo/content";
import {
  and,
  articleVersions,
  articles,
  count,
  desc,
  devices,
  eq,
  isNull,
  ne,
  priceAlerts,
  priceChanges,
  products,
  savedItems,
  sql,
  type DbOrTx,
} from "@repo/db";
import { DomainError } from "./errors";

/**
 * Anonymous mobile devices (FR-API-4): registration, saved items and price-alert subscriptions.
 * A device authenticates with `<deviceId>.<secret>`; only the secret's SHA-256 is stored.
 */

/** Registration is the only unauthenticated mobile write; limit it per hashed IP (NFR-7). */
export const DEVICE_LIMITS = {
  register: { limit: 10, windowSeconds: 3600 },
  /** Per-device caps keep one install from filling tables. */
  maxSaved: 500,
  maxAlerts: 200,
} as const;

export type DevicePlatform = "ios" | "android" | "web";
export type DeviceLocale = "en" | "de";
type ArticleType = (typeof articles.type.enumValues)[number];

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Treat a push token as moved when another install registers it (reinstall, restore from backup). */
async function releasePushToken(db: DbOrTx, pushToken: string, keepDeviceId?: string) {
  await db
    .update(devices)
    .set({ pushToken: null })
    .where(and(eq(devices.pushToken, pushToken), keepDeviceId ? ne(devices.id, keepDeviceId) : undefined));
}

export async function registerDevice(
  db: DbOrTx,
  input: { platform: DevicePlatform; locale?: DeviceLocale; appVersion?: string | null; pushToken?: string | null },
): Promise<{ deviceId: string; token: string }> {
  const secret = randomBytes(32).toString("base64url");
  return db.transaction(async (tx) => {
    if (input.pushToken) await releasePushToken(tx, input.pushToken);
    const [row] = await tx
      .insert(devices)
      .values({
        secretHash: sha256(secret),
        platform: input.platform,
        locale: input.locale ?? "en",
        appVersion: input.appVersion ?? null,
        pushToken: input.pushToken ?? null,
      })
      .returning({ id: devices.id });
    return { deviceId: row!.id, token: `${row!.id}.${secret}` };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves `Authorization: Bearer <deviceId>.<secret>` to a device, or null. Touches `lastSeenAt`
 * at most hourly so reads do not turn into writes on every request.
 */
export async function authenticateDevice(db: DbOrTx, authorization: string | null | undefined, now = new Date()) {
  const match = /^Bearer\s+([^.\s]+)\.([A-Za-z0-9_-]{20,})$/.exec(authorization?.trim() ?? "");
  if (!match || !UUID.test(match[1]!)) return null;
  const [row] = await db.select().from(devices).where(eq(devices.id, match[1]!)).limit(1);
  if (!row) return null;
  const expected = Buffer.from(row.secretHash, "hex");
  const actual = Buffer.from(sha256(match[2]!), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > 3600_000) {
    await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, row.id));
  }
  return row;
}

export async function updateDevice(
  db: DbOrTx,
  deviceId: string,
  input: { pushToken?: string | null; locale?: DeviceLocale; appVersion?: string | null },
) {
  return db.transaction(async (tx) => {
    if (input.pushToken) await releasePushToken(tx, input.pushToken, deviceId);
    await tx
      .update(devices)
      .set({
        ...(input.pushToken !== undefined ? { pushToken: input.pushToken, disabledAt: null } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.appVersion !== undefined ? { appVersion: input.appVersion } : {}),
        lastSeenAt: new Date(),
      })
      .where(eq(devices.id, deviceId));
  });
}

/** "Delete my data": removes the device with its saved items and alerts (cascade). */
export async function deleteDevice(db: DbOrTx, deviceId: string) {
  await db.delete(devices).where(eq(devices.id, deviceId));
}

export async function getDeviceSummary(db: DbOrTx, deviceId: string) {
  const [row] = await db
    .select({
      deviceId: devices.id,
      platform: devices.platform,
      locale: devices.locale,
      pushToken: devices.pushToken,
      disabledAt: devices.disabledAt,
      savedCount: sql<number>`(select count(*)::int from saved_items s where s.device_id = "devices"."id")`,
      alertCount: sql<number>`(select count(*)::int from price_alerts p where p.device_id = "devices"."id")`,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Device not found");
  return {
    deviceId: row.deviceId,
    platform: row.platform as DevicePlatform,
    locale: (row.locale === "de" ? "de" : "en") as DeviceLocale,
    pushEnabled: Boolean(row.pushToken) && !row.disabledAt,
    savedCount: row.savedCount,
    alertCount: row.alertCount,
  };
}

const isLive = () => and(sql`${articles.publishedVersionId} is not null`, ne(articles.status, "archived"));

/** Saved articles, newest first; articles that went offline drop out of the list. */
export async function listSavedItems(db: DbOrTx, deviceId: string, siteUrl: string) {
  const rows = await db
    .select({
      articleId: articles.id,
      type: articles.type,
      slug: articles.slug,
      locale: articles.locale,
      title: articles.title,
      description: sql<string | null>`${articleVersions.seo} ->> 'metaDescription'`,
      score: articleVersions.overallScore,
      productName: products.name,
      savedAt: savedItems.createdAt,
    })
    .from(savedItems)
    .innerJoin(articles, eq(articles.id, savedItems.articleId))
    .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .leftJoin(products, eq(products.id, articles.productId))
    .where(and(eq(savedItems.deviceId, deviceId), isLive()))
    .orderBy(desc(savedItems.createdAt));
  return rows.map((r) => ({
    ...r,
    locale: (r.locale === "de" ? "de" : "en") as DeviceLocale,
    url: `${siteUrl}${localizedArticlePath(r.type, r.slug, r.locale)}`,
  }));
}

export async function saveArticle(
  db: DbOrTx,
  deviceId: string,
  input: { type: ArticleType; slug: string; locale?: DeviceLocale },
) {
  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        eq(articles.type, input.type),
        eq(articles.slug, input.slug),
        eq(articles.locale, input.locale ?? "en"),
        isLive(),
      ),
    )
    .limit(1);
  if (!article) throw new DomainError("not_found", "Article not found");
  const [{ n }] = (await db.select({ n: count() }).from(savedItems).where(eq(savedItems.deviceId, deviceId))) as [
    { n: number },
  ];
  if (n >= DEVICE_LIMITS.maxSaved) throw new DomainError("conflict", "Saved list is full");
  await db.insert(savedItems).values({ deviceId, articleId: article.id }).onConflictDoNothing();
  return { articleId: article.id };
}

export async function unsaveArticle(db: DbOrTx, deviceId: string, articleId: string) {
  await db.delete(savedItems).where(and(eq(savedItems.deviceId, deviceId), eq(savedItems.articleId, articleId)));
}

/** Price alerts with the product's live review (if any) and the latest notified price change. */
export async function listPriceAlerts(db: DbOrTx, deviceId: string) {
  return db
    .select({
      productSlug: products.slug,
      productName: products.name,
      reviewSlug: sql<string | null>`(
        select ${articles.slug} from ${articles}
        where ${articles.productId} = ${products.id} and ${articles.type} = 'review' and ${articles.locale} = 'en'
          and ${articles.publishedVersionId} is not null and ${articles.status} <> 'archived'
        limit 1)`,
      createdAt: priceAlerts.createdAt,
      lastChangeSummary: sql<string | null>`(
        select ${priceChanges.summary} from ${priceChanges}
        where ${priceChanges.productId} = ${products.id} and ${priceChanges.notifiedAt} is not null
        order by ${priceChanges.detectedAt} desc limit 1)`,
      lastChangeAt: sql<string | null>`(
        select ${priceChanges.detectedAt} from ${priceChanges}
        where ${priceChanges.productId} = ${products.id} and ${priceChanges.notifiedAt} is not null
        order by ${priceChanges.detectedAt} desc limit 1)`,
    })
    .from(priceAlerts)
    .innerJoin(products, eq(products.id, priceAlerts.productId))
    .where(eq(priceAlerts.deviceId, deviceId))
    .orderBy(desc(priceAlerts.createdAt));
}

export async function addPriceAlert(db: DbOrTx, deviceId: string, productSlug: string) {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.slug, productSlug), eq(products.locale, "en"), ne(products.status, "archived")))
    .limit(1);
  if (!product) throw new DomainError("not_found", "Product not found");
  const [{ n }] = (await db.select({ n: count() }).from(priceAlerts).where(eq(priceAlerts.deviceId, deviceId))) as [
    { n: number },
  ];
  if (n >= DEVICE_LIMITS.maxAlerts) throw new DomainError("conflict", "Too many price alerts");
  await db.insert(priceAlerts).values({ deviceId, productId: product.id }).onConflictDoNothing();
  return { productId: product.id };
}

export async function removePriceAlert(db: DbOrTx, deviceId: string, productSlug: string) {
  await db
    .delete(priceAlerts)
    .where(
      and(
        eq(priceAlerts.deviceId, deviceId),
        sql`${priceAlerts.productId} in (select ${products.id} from ${products} where ${products.slug} = ${productSlug})`,
      ),
    );
}

// ---------------------------------------------------------------------------------------------
// Price changes (FR-MNT-2 → FR-API-4 push alerts)

export interface PriceChangeLine {
  plan: string;
  /** "changed", "added" or "removed". */
  kind: "changed" | "added" | "removed";
  before: { price: number | null; currency: string; period: string } | null;
  after: { price: number | null; currency: string; period: string } | null;
}

type Tier = { name: string; price: number | null; currency: string; period: string };

const tiersOf = (sheet: FactSheet | null | undefined): Tier[] =>
  (sheet?.pricing?.tiers.value ?? []).map((t) => ({
    name: t.name,
    price: t.price,
    currency: t.currency,
    period: t.period,
  }));

/**
 * Plan-level price differences between two fact sheets: price, currency or billing period changed,
 * plans added or removed. Highlights and limits are ignored (they are not "price changes").
 */
export function diffPricing(
  before: FactSheet | null | undefined,
  after: FactSheet | null | undefined,
): PriceChangeLine[] {
  const a = tiersOf(before);
  const b = tiersOf(after);
  if (a.length === 0 || b.length === 0) return [];
  const key = (t: Tier) => t.name.trim().toLowerCase();
  const pick = (t: Tier) => ({ price: t.price, currency: t.currency, period: t.period });
  const lines: PriceChangeLine[] = [];
  for (const t of b) {
    const old = a.find((x) => key(x) === key(t));
    if (!old) lines.push({ plan: t.name, kind: "added", before: null, after: pick(t) });
    else if (old.price !== t.price || old.currency !== t.currency || old.period !== t.period) {
      lines.push({ plan: t.name, kind: "changed", before: pick(old), after: pick(t) });
    }
  }
  for (const t of a) {
    if (!b.some((x) => key(x) === key(t))) lines.push({ plan: t.name, kind: "removed", before: pick(t), after: null });
  }
  return lines;
}

const PERIOD_SHORT: Record<string, Record<DeviceLocale, string>> = {
  month: { en: "/mo", de: "/Monat" },
  year: { en: "/yr", de: "/Jahr" },
  one_time: { en: " once", de: " einmalig" },
  usage: { en: " usage-based", de: " nutzungsbasiert" },
  custom: { en: " custom", de: " individuell" },
};

export function formatPrice(p: PriceChangeLine["after"], locale: DeviceLocale = "en"): string {
  if (!p) return "—";
  if (p.price === null) return locale === "de" ? "auf Anfrage" : "custom";
  if (p.price === 0) return locale === "de" ? "kostenlos" : "free";
  const amount = new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-US", {
    style: "currency",
    currency: p.currency,
    maximumFractionDigits: p.price % 1 === 0 ? 0 : 2,
  }).format(p.price);
  return `${amount}${PERIOD_SHORT[p.period]?.[locale] ?? ""}`;
}

/** One short line per change, e.g. "Pro: $10/mo → $12/mo". */
export function describePriceChanges(lines: PriceChangeLine[], locale: DeviceLocale = "en"): string {
  const words =
    locale === "de" ? { added: "neu", removed: "entfällt" } : { added: "new plan", removed: "plan removed" };
  return lines
    .slice(0, 4)
    .map((l) =>
      l.kind === "added"
        ? `${l.plan}: ${formatPrice(l.after, locale)} (${words.added})`
        : l.kind === "removed"
          ? `${l.plan}: ${words.removed}`
          : `${l.plan}: ${formatPrice(l.before, locale)} → ${formatPrice(l.after, locale)}`,
    )
    .join("; ")
    .concat(lines.length > 4 ? (locale === "de" ? " …" : " …") : "");
}

/**
 * Records a detected price change for push alerts. Idempotent per (product, job), so a retried
 * refresh step does not notify twice. Returns null when there is nothing to record.
 */
export async function recordPriceChange(
  db: DbOrTx,
  input: { productId: string; jobId?: string | null; lines: PriceChangeLine[] },
) {
  if (input.lines.length === 0) return null;
  if (input.jobId) {
    const [existing] = await db
      .select({ id: priceChanges.id })
      .from(priceChanges)
      .where(and(eq(priceChanges.productId, input.productId), eq(priceChanges.jobId, input.jobId)))
      .limit(1);
    if (existing) return existing;
  }
  const [row] = await db
    .insert(priceChanges)
    .values({
      productId: input.productId,
      jobId: input.jobId ?? null,
      summary: describePriceChanges(input.lines, "en"),
      changes: input.lines as unknown as Array<Record<string, unknown>>,
    })
    .returning({ id: priceChanges.id });
  return row!;
}

// ---------------------------------------------------------------------------------------------
// CMS overview

export async function mobileStats(db: DbOrTx) {
  const [byPlatform, alertsByProduct, recentChanges, [totals]] = await Promise.all([
    db
      .select({
        platform: devices.platform,
        locale: devices.locale,
        devices: sql<number>`count(*)::int`,
        pushEnabled: sql<number>`count(*) filter (where ${devices.pushToken} is not null and ${devices.disabledAt} is null)::int`,
        active30d: sql<number>`count(*) filter (where ${devices.lastSeenAt} > now() - interval '30 days')::int`,
      })
      .from(devices)
      .groupBy(devices.platform, devices.locale)
      .orderBy(devices.platform, devices.locale),
    db
      .select({
        productId: products.id,
        productName: products.name,
        productSlug: products.slug,
        alerts: sql<number>`count(*)::int`,
      })
      .from(priceAlerts)
      .innerJoin(products, eq(products.id, priceAlerts.productId))
      .groupBy(products.id, products.name, products.slug)
      .orderBy(desc(sql`count(*)`))
      .limit(50),
    db
      .select({
        id: priceChanges.id,
        productId: priceChanges.productId,
        productName: products.name,
        summary: priceChanges.summary,
        jobId: priceChanges.jobId,
        detectedAt: priceChanges.detectedAt,
        notifiedAt: priceChanges.notifiedAt,
        pushSent: priceChanges.pushSent,
        pushFailed: priceChanges.pushFailed,
      })
      .from(priceChanges)
      .innerJoin(products, eq(products.id, priceChanges.productId))
      .orderBy(desc(priceChanges.detectedAt))
      .limit(50),
    db
      .select({
        devices: sql<number>`count(*)::int`,
        saved: sql<number>`(select count(*)::int from ${savedItems})`,
        alerts: sql<number>`(select count(*)::int from ${priceAlerts})`,
        pendingChanges: sql<number>`(select count(*)::int from ${priceChanges} where ${priceChanges.notifiedAt} is null)`,
      })
      .from(devices),
  ]);
  return { byPlatform, alertsByProduct, recentChanges, totals: totals! };
}

/** Devices that should receive a push for a product: subscribed, push token present, not disabled. */
export async function pushTargetsForProduct(db: DbOrTx, productId: string) {
  return db
    .select({ deviceId: devices.id, pushToken: devices.pushToken, locale: devices.locale })
    .from(priceAlerts)
    .innerJoin(devices, eq(devices.id, priceAlerts.deviceId))
    .where(
      and(eq(priceAlerts.productId, productId), sql`${devices.pushToken} is not null`, isNull(devices.disabledAt)),
    );
}
