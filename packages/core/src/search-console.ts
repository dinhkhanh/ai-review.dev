import { CONTENT_LOCALES, DEFAULT_CONTENT_LOCALE, localizedArticlePath } from "@repo/content";
import {
  and,
  articles,
  desc,
  eq,
  inArray,
  ne,
  searchConsoleDaily,
  searchConsoleQueries,
  sql,
  type DbOrTx,
} from "@repo/db";

/**
 * Search Console import (FR-MNT-3): daily clicks/impressions/position per page into
 * `search_console_daily`, and the top queries per page over the latest window into
 * `search_console_queries`. Re-importing a day overwrites it, so overlapping windows are safe.
 */

/** Structural match for `SearchConsoleClient` in @repo/ai (core does not depend on the adapters). */
export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  /** Returned by the API; unused (recomputed from clicks/impressions when needed). */
  ctr?: number;
  position: number;
}
export interface SearchConsoleClient {
  query(input: {
    startDate: string;
    endDate: string;
    dimensions: Array<"date" | "page" | "query">;
    maxRows?: number;
  }): Promise<SearchAnalyticsRow[]>;
}

const DAY_MS = 24 * 3600 * 1000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/** Search Console keeps 16 months of data. */
export const SEARCH_CONSOLE_MAX_BACKFILL_DAYS = 486;
/** Data is final after ~2–3 days, so the daily run re-imports a trailing window. */
export const SEARCH_CONSOLE_TRAILING_DAYS = 10;
/** Queries kept per page (by clicks, then impressions). */
export const TOP_QUERIES_PER_PAGE = 20;

/** "https://ai-review.dev/de/reviews/x/?a=1" → "/de/reviews/x"; null for unparseable keys. */
export function sitePathFromUrl(page: string): string | null {
  try {
    const path = new URL(page, "https://placeholder.invalid").pathname;
    const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
    return decodeURI(trimmed).slice(0, 500);
  } catch {
    return null;
  }
}

/** Splits the locale prefix off a site path: "/de/reviews/x" → { locale: "de", path: "/reviews/x" }. */
export function splitLocalePath(path: string): { locale: string; path: string } {
  const m = /^\/([a-z]{2})(\/.*)?$/.exec(path);
  if (m && m[1] !== DEFAULT_CONTENT_LOCALE && (CONTENT_LOCALES as readonly string[]).includes(m[1]!)) {
    return { locale: m[1]!, path: m[2] ?? "/" };
  }
  return { locale: DEFAULT_CONTENT_LOCALE, path };
}

/**
 * Site path → article id for every article, built from `localizedArticlePath` (the one function the
 * web app uses for article URLs), so locale prefixes and localised segments resolve the same way.
 */
export async function articlePathIndex(db: DbOrTx): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: articles.id, type: articles.type, slug: articles.slug, locale: articles.locale })
    .from(articles);
  return new Map(rows.map((a) => [localizedArticlePath(a.type, a.slug, a.locale), a.id]));
}

export interface SearchConsoleImportOptions {
  /** Inclusive last day to import; defaults to yesterday (UTC). Final data lags 2–3 days. */
  to?: Date;
  /** Days to import ending at `to`; defaults to the trailing window, capped at 16 months. */
  days?: number;
  /** Window for top queries; defaults to 28 days. */
  queryWindowDays?: number;
  now?: Date;
}

export interface SearchConsoleImportResult {
  from: string;
  to: string;
  dailyRows: number;
  articleRows: number;
  queryRows: number;
  latestDay: string | null;
}

/** Imports daily page performance and the latest top queries per page. */
export async function importSearchConsole(
  db: DbOrTx,
  client: SearchConsoleClient,
  opts: SearchConsoleImportOptions = {},
): Promise<SearchConsoleImportResult> {
  const now = opts.now ?? new Date();
  const to = opts.to ?? addDays(now, -1);
  const days = Math.min(Math.max(1, opts.days ?? SEARCH_CONSOLE_TRAILING_DAYS), SEARCH_CONSOLE_MAX_BACKFILL_DAYS);
  const from = addDays(to, -(days - 1));
  const index = await articlePathIndex(db);
  const resolve = (path: string) => index.get(path) ?? null;

  // Chunked so a 16-month backfill never asks for one huge result set.
  let dailyRows = 0;
  let articleRows = 0;
  let latestDay: string | null = null;
  for (let start = from; start <= to; start = addDays(start, 90)) {
    const end = new Date(Math.min(addDays(start, 89).getTime(), to.getTime()));
    const rows = await client.query({ startDate: day(start), endDate: day(end), dimensions: ["date", "page"] });
    const merged = mergeDailyRows(rows);
    for (let i = 0; i < merged.length; i += 500) {
      const batch = merged.slice(i, i + 500).map((r) => ({ ...r, articleId: resolve(r.page) }));
      articleRows += batch.filter((r) => r.articleId).length;
      await db
        .insert(searchConsoleDaily)
        .values(batch)
        .onConflictDoUpdate({
          target: [searchConsoleDaily.day, searchConsoleDaily.page],
          set: {
            clicks: sql`excluded.clicks`,
            impressions: sql`excluded.impressions`,
            position: sql`excluded.position`,
            articleId: sql`excluded.article_id`,
          },
        });
    }
    dailyRows += merged.length;
    for (const r of merged) if (!latestDay || r.day > latestDay) latestDay = r.day;
  }

  const windowDays = opts.queryWindowDays ?? 28;
  const queryRows = await importTopQueries(db, client, { to, windowDays, resolve });
  return { from: day(from), to: day(to), dailyRows, articleRows, queryRows, latestDay };
}

/**
 * Several URLs can map to one path (trailing slash, query strings, http/https): sum them, with
 * the impression-weighted position.
 */
export function mergeDailyRows(rows: SearchAnalyticsRow[]) {
  const acc = new Map<string, { day: string; page: string; clicks: number; impressions: number; posSum: number }>();
  for (const r of rows) {
    const [d, url] = r.keys;
    const page = url ? sitePathFromUrl(url) : null;
    if (!d || !page) continue;
    const key = `${d}|${page}`;
    const cur = acc.get(key) ?? { day: d, page, clicks: 0, impressions: 0, posSum: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.posSum += r.position * r.impressions;
    acc.set(key, cur);
  }
  return [...acc.values()].map((r) => ({
    day: r.day,
    page: r.page,
    clicks: Math.round(r.clicks),
    impressions: Math.round(r.impressions),
    position: r.impressions > 0 ? r.posSum / r.impressions : null,
  }));
}

async function importTopQueries(
  db: DbOrTx,
  client: SearchConsoleClient,
  opts: { to: Date; windowDays: number; resolve: (path: string) => string | null },
): Promise<number> {
  const windowEnd = day(opts.to);
  const rows = await client.query({
    startDate: day(addDays(opts.to, -(opts.windowDays - 1))),
    endDate: windowEnd,
    dimensions: ["page", "query"],
    maxRows: 100_000,
  });
  const byPage = new Map<string, Map<string, { clicks: number; impressions: number; posSum: number }>>();
  for (const r of rows) {
    const [url, query] = r.keys;
    const page = url ? sitePathFromUrl(url) : null;
    if (!page || !query) continue;
    const queries = byPage.get(page) ?? new Map();
    const cur = queries.get(query) ?? { clicks: 0, impressions: 0, posSum: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.posSum += r.position * r.impressions;
    queries.set(query, cur);
    byPage.set(page, queries);
  }
  const values = [...byPage.entries()].flatMap(([page, queries]) =>
    [...queries.entries()]
      .sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions)
      .slice(0, TOP_QUERIES_PER_PAGE)
      .map(([query, m]) => ({
        page,
        query: query.slice(0, 500),
        articleId: opts.resolve(page),
        windowEnd,
        clicks: Math.round(m.clicks),
        impressions: Math.round(m.impressions),
        position: m.impressions > 0 ? m.posSum / m.impressions : null,
      })),
  );
  // The window query covers every page, so the new window replaces the old one wholesale.
  await db.transaction(async (tx) => {
    for (let i = 0; i < values.length; i += 500) {
      await tx
        .insert(searchConsoleQueries)
        .values(values.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [searchConsoleQueries.page, searchConsoleQueries.query],
          set: {
            articleId: sql`excluded.article_id`,
            windowEnd: sql`excluded.window_end`,
            clicks: sql`excluded.clicks`,
            impressions: sql`excluded.impressions`,
            position: sql`excluded.position`,
          },
        });
    }
    if (values.length) await tx.delete(searchConsoleQueries).where(ne(searchConsoleQueries.windowEnd, windowEnd));
  });
  return values.length;
}

/** Latest imported day and totals, for the CMS status line. */
export async function searchConsoleStatus(db: DbOrTx) {
  const [row] = await db
    .select({
      latestDay: sql<string | null>`max(${searchConsoleDaily.day})::text`,
      firstDay: sql<string | null>`min(${searchConsoleDaily.day})::text`,
      rows: sql<number>`count(*)::int`,
      articlePages: sql<number>`count(distinct ${searchConsoleDaily.articleId})::int`,
    })
    .from(searchConsoleDaily);
  return row ?? { latestDay: null, firstDay: null, rows: 0, articlePages: 0 };
}

/** Top queries for one or more articles over the latest window (CMS decay list, refresh briefs). */
export async function topQueriesForArticles(db: DbOrTx, articleIds: string[], perArticle = 5) {
  if (!articleIds.length)
    return new Map<string, Array<{ query: string; clicks: number; impressions: number; position: number | null }>>();
  const rows = await db
    .select({
      articleId: searchConsoleQueries.articleId,
      query: searchConsoleQueries.query,
      clicks: searchConsoleQueries.clicks,
      impressions: searchConsoleQueries.impressions,
      position: searchConsoleQueries.position,
    })
    .from(searchConsoleQueries)
    .where(inArray(searchConsoleQueries.articleId, articleIds))
    .orderBy(desc(searchConsoleQueries.clicks), desc(searchConsoleQueries.impressions));
  const out = new Map<string, Array<{ query: string; clicks: number; impressions: number; position: number | null }>>();
  for (const r of rows) {
    const list = out.get(r.articleId!) ?? [];
    if (list.length < perArticle)
      list.push({ query: r.query, clicks: r.clicks, impressions: r.impressions, position: r.position });
    out.set(r.articleId!, list);
  }
  return out;
}

/** Daily series for one article (CMS panel). */
export async function articleSearchSeries(db: DbOrTx, articleId: string, opts: { days?: number; now?: Date } = {}) {
  const since = day(addDays(opts.now ?? new Date(), -(opts.days ?? 90)));
  return db
    .select({
      day: searchConsoleDaily.day,
      clicks: sql<number>`sum(${searchConsoleDaily.clicks})::int`,
      impressions: sql<number>`sum(${searchConsoleDaily.impressions})::int`,
      position: sql<
        number | null
      >`(sum(${searchConsoleDaily.position} * ${searchConsoleDaily.impressions}) / nullif(sum(${searchConsoleDaily.impressions}), 0))::real`,
    })
    .from(searchConsoleDaily)
    .where(and(eq(searchConsoleDaily.articleId, articleId), sql`${searchConsoleDaily.day} >= ${since}`))
    .groupBy(searchConsoleDaily.day)
    .orderBy(searchConsoleDaily.day);
}
