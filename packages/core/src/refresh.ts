import {
  affiliateLinks,
  and,
  articles,
  asc,
  eq,
  inArray,
  isNull,
  pageViewsDaily,
  products,
  reviewJobs,
  sql,
  type DbOrTx,
} from "@repo/db";
import { DomainError } from "./errors";
import { getSetting, type SettingValue } from "./settings";

export type RefreshPolicy = SettingValue<"refresh.policy">;

export const DEFAULT_REFRESH_POLICY: RefreshPolicy = {
  enabled: true,
  defaultIntervalDays: 60,
  topTrafficIntervalDays: 14,
  topTrafficMinPageviews30d: 1000,
  maxJobsPerRun: 5,
};

const DAY_MS = 24 * 3600 * 1000;

/**
 * Refresh cadence (FR-MNT-1): the product's own interval (default 60 days), shortened to the
 * top-traffic interval (default 14 days) when its pages had enough views in the last 30 days.
 */
export function refreshIntervalDays(
  product: { refreshIntervalDays: number },
  policy: RefreshPolicy,
  pageviews30d: number,
): number {
  const base = product.refreshIntervalDays || policy.defaultIntervalDays;
  return pageviews30d >= policy.topTrafficMinPageviews30d && policy.topTrafficMinPageviews30d > 0
    ? Math.min(base, policy.topTrafficIntervalDays)
    : base;
}

/** Page views of all live articles about a product in the last 30 days (Plausible import). */
export async function productPageviews30d(db: DbOrTx, productId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${pageViewsDaily.pageviews}), 0)::int` })
    .from(pageViewsDaily)
    .innerJoin(articles, eq(articles.id, pageViewsDaily.articleId))
    .where(and(sql`${productId} = any(${articles.productIds})`, sql`${pageViewsDaily.day} >= ${since}`));
  return row?.n ?? 0;
}

/** Sets `next_refresh_at` after research completes. Returns the date and interval used. */
export async function scheduleNextRefresh(db: DbOrTx, productId: string, now = new Date()) {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) throw new DomainError("not_found", `Product ${productId} not found`);
  const policy = (await getSetting(db, "refresh.policy")) ?? DEFAULT_REFRESH_POLICY;
  const days = refreshIntervalDays(product, policy, await productPageviews30d(db, productId, now));
  const next = product.discontinuedAt ? null : new Date(now.getTime() + days * DAY_MS);
  await db.update(products).set({ nextRefreshAt: next }).where(eq(products.id, productId));
  return { nextRefreshAt: next, intervalDays: days };
}

/**
 * Products due for a refresh: scheduled date passed, not discontinued, with a live article, and no
 * job already queued or running for them. Oldest first.
 */
export async function dueRefreshProducts(db: DbOrTx, now = new Date(), limit = 5) {
  return db
    .select({ id: products.id, name: products.name, nextRefreshAt: products.nextRefreshAt })
    .from(products)
    .where(
      and(
        sql`${products.nextRefreshAt} <= ${now.toISOString()}::timestamptz`,
        isNull(products.discontinuedAt),
        inArray(products.status, ["active", "draft"]),
        sql`exists (select 1 from ${articles} a where a.product_id = ${products.id} and a.published_version_id is not null and a.status <> 'archived')`,
        sql`not exists (select 1 from ${reviewJobs} j where j.product_id = ${products.id} and j.status in ('queued', 'running', 'awaiting_approval'))`,
      ),
    )
    .orderBy(asc(products.nextRefreshAt))
    .limit(Math.max(0, limit));
}

/** Pushes the next refresh out (used as a lease when a refresh job is created, so it is not re-picked). */
export async function deferRefresh(db: DbOrTx, productId: string, days: number, now = new Date()) {
  await db
    .update(products)
    .set({ nextRefreshAt: new Date(now.getTime() + days * DAY_MS) })
    .where(eq(products.id, productId));
}

/**
 * Dead product handling (FR-MNT-4): marks the product discontinued with a visitor-facing note,
 * stops refreshes and pauses its active affiliate links. Articles stay live with a banner that
 * promotes alternatives. Returns the number of links paused.
 */
export async function markProductDiscontinued(db: DbOrTx, productId: string, note: string, now = new Date()) {
  return db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({ status: "discontinued", discontinuedAt: now, statusNote: note.slice(0, 500), nextRefreshAt: null })
      .where(eq(products.id, productId));
    const paused = await tx
      .update(affiliateLinks)
      .set({ status: "paused", healthDetail: `Paused: product discontinued (${note.slice(0, 200)})` })
      .where(and(eq(affiliateLinks.productId, productId), inArray(affiliateLinks.status, ["active", "pending"])))
      .returning({ id: affiliateLinks.id });
    return paused.length;
  });
}

/** Undo for a false positive: product active again and back on the refresh schedule. Links stay paused for review. */
export async function reactivateProduct(db: DbOrTx, productId: string, now = new Date()) {
  await db
    .update(products)
    .set({ status: "active", discontinuedAt: null, statusNote: null })
    .where(eq(products.id, productId));
  return scheduleNextRefresh(db, productId, now);
}
