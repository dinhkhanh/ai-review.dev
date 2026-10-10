import { and, articles, eq, inArray, products, searchConsoleDaily, sql, type DbOrTx } from "@repo/db";
import { isoWeek } from "./affiliate";
import { notify } from "./notifications";
import { pullRefreshForward } from "./refresh";
import { getSetting, type SettingValue } from "./settings";

/**
 * Content decay (FR-MNT-3): compares each live article's Search Console performance over the last
 * `windowDays` with the `windowDays` before. A sustained click drop (or a ranking loss on a page
 * that had traffic) flags the article for refresh, notifies the editor and, optionally, pulls the
 * product's next refresh forward. A refresh clears the flag; refreshed pages get one window to
 * recover before they can be flagged again.
 */

export type DecayPolicy = SettingValue<"searchConsole.policy">;

export const DEFAULT_DECAY_POLICY: DecayPolicy = {
  enabled: true,
  windowDays: 28,
  minClickDrop: 0.3,
  minBaselineClicks: 20,
  scheduleRefresh: true,
};

/** Average position lost (higher number = worse) that counts as decay on its own. */
export const DECAY_POSITION_LOSS = 3;

const DAY_MS = 24 * 3600 * 1000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string) => new Date(`${s}T00:00:00Z`);

export interface WindowMetrics {
  clicks: number;
  impressions: number;
  /** Impression-weighted average position, null without impressions. */
  position: number | null;
}

export interface DecaySignal {
  reasons: Array<"clicks" | "position">;
  windowDays: number;
  /** Last day of the current window (the latest imported day). */
  anchorDay: string;
  current: WindowMetrics;
  previous: WindowMetrics;
  /** Relative click change, e.g. -0.42 for a 42 % drop; null without a baseline. */
  clickChange: number | null;
  /** Positions lost (positive = worse ranking); null when either window had no impressions. */
  positionChange: number | null;
  checkedAt: string;
}

/** Pure decision for one article; null when the page is healthy or has too little data. */
export function evaluateDecay(
  current: WindowMetrics,
  previous: WindowMetrics,
  policy: Pick<DecayPolicy, "minClickDrop" | "minBaselineClicks">,
): { reasons: DecaySignal["reasons"]; clickChange: number | null; positionChange: number | null } | null {
  if (previous.clicks < policy.minBaselineClicks || previous.clicks <= 0) return null;
  const clickChange = (current.clicks - previous.clicks) / previous.clicks;
  const positionChange =
    current.position != null && previous.position != null ? current.position - previous.position : null;
  const reasons: DecaySignal["reasons"] = [];
  if (-clickChange >= policy.minClickDrop) reasons.push("clicks");
  if (positionChange != null && positionChange >= DECAY_POSITION_LOSS) reasons.push("position");
  return reasons.length ? { reasons, clickChange, positionChange } : null;
}

async function windowMetrics(db: DbOrTx, from: string, to: string) {
  const rows = await db
    .select({
      articleId: searchConsoleDaily.articleId,
      clicks: sql<number>`sum(${searchConsoleDaily.clicks})::int`,
      impressions: sql<number>`sum(${searchConsoleDaily.impressions})::int`,
      position: sql<
        number | null
      >`(sum(${searchConsoleDaily.position} * ${searchConsoleDaily.impressions}) / nullif(sum(${searchConsoleDaily.impressions}), 0))::real`,
    })
    .from(searchConsoleDaily)
    .where(
      and(sql`${searchConsoleDaily.articleId} is not null`, sql`${searchConsoleDaily.day} between ${from} and ${to}`),
    )
    .groupBy(searchConsoleDaily.articleId);
  return new Map(
    rows.map((r) => [r.articleId!, { clicks: r.clicks, impressions: r.impressions, position: r.position }]),
  );
}

export interface DecayRunResult {
  anchorDay: string | null;
  checked: number;
  flagged: string[];
  cleared: string[];
  refreshesPulled: number;
}

/** Runs detection over every live article. Safe to run repeatedly (daily after the import). */
export async function detectContentDecay(
  db: DbOrTx,
  opts: { now?: Date; policy?: DecayPolicy; notify?: boolean } = {},
): Promise<DecayRunResult> {
  const now = opts.now ?? new Date();
  const policy = opts.policy ?? (await getSetting(db, "searchConsole.policy")) ?? DEFAULT_DECAY_POLICY;
  const empty: DecayRunResult = { anchorDay: null, checked: 0, flagged: [], cleared: [], refreshesPulled: 0 };
  if (!policy.enabled) return empty;

  // Anchor on the latest imported day: Search Console lags, so "today" would undercount.
  const [latest] = await db
    .select({ d: sql<string | null>`max(${searchConsoleDaily.day})::text` })
    .from(searchConsoleDaily);
  if (!latest?.d) return empty;
  const anchor = parseDay(latest.d);
  const w = policy.windowDays;
  const curFrom = day(new Date(anchor.getTime() - (w - 1) * DAY_MS));
  const prevTo = day(new Date(anchor.getTime() - w * DAY_MS));
  const prevFrom = day(new Date(anchor.getTime() - (2 * w - 1) * DAY_MS));
  const [current, previous] = await Promise.all([
    windowMetrics(db, curFrom, latest.d),
    windowMetrics(db, prevFrom, prevTo),
  ]);

  const live = await db
    .select({
      id: articles.id,
      title: articles.title,
      locale: articles.locale,
      productId: articles.productId,
      lastVerifiedAt: articles.lastVerifiedAt,
      decayDetectedAt: articles.decayDetectedAt,
      decaySignal: articles.decaySignal,
    })
    .from(articles)
    .where(and(sql`${articles.publishedVersionId} is not null`, sql`${articles.status} <> 'archived'`));

  const result: DecayRunResult = { ...empty, anchorDay: latest.d, checked: live.length };
  const graceStart = new Date(now.getTime() - w * DAY_MS);
  const toPull = new Set<string>();
  const zero: WindowMetrics = { clicks: 0, impressions: 0, position: null };

  for (const a of live) {
    const refreshedSinceFlag = a.decayDetectedAt && a.lastVerifiedAt && a.lastVerifiedAt > a.decayDetectedAt;
    const dismissedAt =
      !a.decayDetectedAt && typeof a.decaySignal?.dismissedAt === "string" ? new Date(a.decaySignal.dismissedAt) : null;
    const inGrace =
      (a.lastVerifiedAt != null && a.lastVerifiedAt > graceStart) || (dismissedAt != null && dismissedAt > graceStart);
    const cur = current.get(a.id) ?? zero;
    const prev = previous.get(a.id) ?? zero;
    const verdict = evaluateDecay(cur, prev, policy);

    if (a.decayDetectedAt && (refreshedSinceFlag || !verdict)) {
      await db.update(articles).set({ decayDetectedAt: null, decaySignal: null }).where(eq(articles.id, a.id));
      result.cleared.push(a.id);
      continue;
    }
    if (!verdict || inGrace) continue;

    const signal: DecaySignal = {
      ...verdict,
      windowDays: w,
      anchorDay: latest.d,
      current: cur,
      previous: prev,
      checkedAt: now.toISOString(),
    };
    await db
      .update(articles)
      .set({ decayDetectedAt: a.decayDetectedAt ?? now, decaySignal: signal as unknown as Record<string, unknown> })
      .where(eq(articles.id, a.id));
    if (!a.decayDetectedAt) {
      result.flagged.push(a.id);
      if (a.productId) toPull.add(a.productId);
      if (opts.notify !== false) {
        const pct = Math.round(-(verdict.clickChange ?? 0) * 100);
        await notify(db, {
          event: "content.decay",
          title: `Search traffic down ${pct}% for "${a.title}"`.slice(0, 300),
          body: `Clicks ${prev.clicks} → ${cur.clicks} over ${w} days${
            verdict.positionChange != null
              ? `; average position ${fmtPos(prev.position)} → ${fmtPos(cur.position)}`
              : ""
          }${a.locale !== "en" ? ` (${a.locale})` : ""}.`,
          href: "/decay",
          entityType: "article",
          entityId: a.id,
          dedupeKey: `content.decay:${a.id}:${isoWeek(now)}`,
        });
      }
    } else if (a.productId) {
      // Still decaying: keep the refresh pulled forward in case it was rescheduled meanwhile.
      toPull.add(a.productId);
    }
  }

  if (policy.scheduleRefresh && toPull.size) {
    result.refreshesPulled = await pullRefreshForward(db, [...toPull], now);
  }
  return result;
}

const fmtPos = (p: number | null) => (p == null ? "–" : p.toFixed(1));

/** Flagged articles for the CMS "Needs refresh" list, worst drop first. */
export async function listDecayingArticles(db: DbOrTx) {
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      type: articles.type,
      slug: articles.slug,
      locale: articles.locale,
      productId: articles.productId,
      productName: products.name,
      productNextRefreshAt: products.nextRefreshAt,
      productDiscontinuedAt: products.discontinuedAt,
      lastVerifiedAt: articles.lastVerifiedAt,
      decayDetectedAt: articles.decayDetectedAt,
      decaySignal: articles.decaySignal,
    })
    .from(articles)
    .leftJoin(products, eq(products.id, articles.productId))
    .where(sql`${articles.decayDetectedAt} is not null`);
  return rows
    .map((r) => ({ ...r, signal: r.decaySignal as unknown as DecaySignal | null }))
    .sort((a, b) => (a.signal?.clickChange ?? 0) - (b.signal?.clickChange ?? 0));
}

/**
 * Clears the flag by hand (e.g. a seasonal dip the editor accepts). The article is not flagged
 * again for one window.
 */
export async function dismissDecay(db: DbOrTx, articleIds: string[], now = new Date()) {
  if (!articleIds.length) return 0;
  const rows = await db
    .update(articles)
    .set({ decayDetectedAt: null, decaySignal: { dismissedAt: now.toISOString() } })
    .where(and(inArray(articles.id, articleIds), sql`${articles.decayDetectedAt} is not null`))
    .returning({ id: articles.id });
  return rows.length;
}

/** Number of flagged articles (dashboard badge). */
export async function decayingArticleCount(db: DbOrTx) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(articles)
    .where(sql`${articles.decayDetectedAt} is not null`);
  return row?.n ?? 0;
}
