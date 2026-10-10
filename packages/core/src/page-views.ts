import { and, articles, eq, inArray, pageViewsDaily, sql, type DbOrTx } from "@repo/db";

type ArticleType = (typeof articles.type.enumValues)[number];

/** Public URL prefix per article type (the web app's routes). */
export const ARTICLE_PATH_PREFIX: Record<ArticleType, string> = {
  review: "reviews",
  comparison: "compare",
  alternatives: "alternatives",
  best_of: "best",
};

/** "/reviews/notion-review?x=1" -> { type: "review", slug: "notion-review" }; other paths -> null. */
export function articleRefFromPath(path: string): { type: ArticleType; slug: string } | null {
  const m = /^\/(reviews|compare|alternatives|best)\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path);
  if (!m) return null;
  const type = (Object.entries(ARTICLE_PATH_PREFIX).find(([, p]) => p === m[1])?.[0] ?? "review") as ArticleType;
  return { type, slug: decodeURIComponent(m[2]!) };
}

export interface PlausibleImportOptions {
  apiKey: string;
  /** Plausible site id, i.e. the domain (NEXT_PUBLIC_PLAUSIBLE_DOMAIN). */
  siteId: string;
  from: Date;
  to: Date;
  /** Self-hosted Plausible base URL; defaults to plausible.io. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Imports daily pageviews per page from the Plausible Stats API v2 (FR-ANL-2 funnel, FR-MNT-1
 * top-traffic cadence) into `page_views_daily`, linking article pages to their article.
 * Re-importing a day overwrites it, so overlapping windows are safe.
 */
export async function importPlausiblePageViews(db: DbOrTx, opts: PlausibleImportOptions) {
  const fetchImpl = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? "https://plausible.io").replace(/\/$/, "");
  const limit = 10_000;
  const results: Array<{ day: string; path: string; pageviews: number; visitors: number }> = [];
  for (let offset = 0; offset < 500_000; offset += limit) {
    const res = await fetchImpl(`${base}/api/v2/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: opts.siteId,
        metrics: ["pageviews", "visitors"],
        date_range: [day(opts.from), day(opts.to)],
        dimensions: ["time:day", "event:page"],
        pagination: { limit, offset },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok)
      throw new Error(`Plausible responded ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const body = (await res.json()) as { results?: Array<{ dimensions: string[]; metrics: number[] }> };
    const page = body.results ?? [];
    for (const r of page) {
      const [d, path] = r.dimensions;
      if (!d || !path) continue;
      results.push({
        day: d.slice(0, 10),
        path: path.slice(0, 500),
        pageviews: r.metrics[0] ?? 0,
        visitors: r.metrics[1] ?? 0,
      });
    }
    if (page.length < limit) break;
  }

  const refs = results.map((r) => articleRefFromPath(r.path));
  const slugs = [...new Set(refs.filter(Boolean).map((r) => r!.slug))];
  const arts = slugs.length
    ? await db
        .select({ id: articles.id, slug: articles.slug, type: articles.type })
        .from(articles)
        .where(and(inArray(articles.slug, slugs), eq(articles.locale, "en")))
    : [];
  const key = (type: string, slug: string) => `${type}:${slug}`;
  const byRef = new Map(arts.map((a) => [key(a.type, a.slug), a.id]));

  for (let i = 0; i < results.length; i += 500) {
    const batch = results.slice(i, i + 500).map((r, j) => {
      const ref = refs[i + j];
      return { ...r, articleId: ref ? (byRef.get(key(ref.type, ref.slug)) ?? null) : null };
    });
    await db
      .insert(pageViewsDaily)
      .values(batch)
      .onConflictDoUpdate({
        target: [pageViewsDaily.day, pageViewsDaily.path],
        set: {
          pageviews: sql`excluded.pageviews`,
          visitors: sql`excluded.visitors`,
          articleId: sql`excluded.article_id`,
        },
      });
  }
  return { rows: results.length, articlePages: results.filter((_, i) => refs[i]).length };
}

/** Pageviews per article over the last `days` (top-traffic refresh cadence, FR-MNT-1). */
export async function articlePageviews(db: DbOrTx, opts: { days?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const since = day(new Date(now.getTime() - (opts.days ?? 30) * 86_400_000));
  return db
    .select({ articleId: pageViewsDaily.articleId, pageviews: sql<number>`sum(${pageViewsDaily.pageviews})::int` })
    .from(pageViewsDaily)
    .where(and(sql`${pageViewsDaily.articleId} is not null`, sql`${pageViewsDaily.day} >= ${since}`))
    .groupBy(pageViewsDaily.articleId);
}
