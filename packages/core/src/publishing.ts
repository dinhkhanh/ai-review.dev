import { createHash } from "node:crypto";
import { ARTICLE_ROUTE_PREFIX, articlePath } from "@repo/content";
import { articles, authors, categories, eq, products, sql, type DbOrTx } from "@repo/db";
import { dueScheduledArticles, publishArticle } from "./articles";

export interface PublishEnv {
  siteUrl: string;
  revalidateSecret?: string | null;
  indexNowKey?: string | null;
}

export function publishEnvFromProcess(env: NodeJS.ProcessEnv = process.env): PublishEnv {
  return {
    siteUrl: env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    revalidateSecret: env.REVALIDATE_SECRET ?? null,
    indexNowKey: indexNowKeyFrom(env),
  };
}

/**
 * IndexNow key (FR-WEB-4). Public by design (served at /<key>.txt). Defaults to a one-way hash of
 * REVALIDATE_SECRET so no extra variable is needed; set INDEXNOW_KEY to override.
 */
export function indexNowKeyFrom(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.INDEXNOW_KEY) return env.INDEXNOW_KEY;
  if (!env.REVALIDATE_SECRET) return null;
  return createHash("sha256").update(`indexnow:${env.REVALIDATE_SECRET}`).digest("hex").slice(0, 32);
}

/** Pages to revalidate when an article changes (FR-WEB-2): the page, its category, author, home, feeds. */
export async function pathsForArticle(db: DbOrTx, articleId: string): Promise<string[]> {
  const [row] = await db
    .select({ slug: articles.slug, type: articles.type, category: categories.slug, author: authors.slug })
    .from(articles)
    .leftJoin(products, eq(products.id, articles.productId))
    .leftJoin(categories, sql`${categories.id} = coalesce(${articles.categoryId}, ${products.categoryId})`)
    .leftJoin(authors, eq(authors.id, articles.authorId))
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!row) return ["/"];
  return [
    articlePath(row.type, row.slug),
    "/",
    row.type === "review" ? "/reviews" : ARTICLE_ROUTE_PREFIX[row.type],
    ...(row.category ? [`/categories/${row.category}`] : []),
    ...(row.author ? [`/authors/${row.author}`] : []),
    "/sitemap.xml",
    "/feed.xml",
  ];
}

/** Asks the web app to revalidate paths (FR-WEB-2, FR-AFF-8). Never throws; returns the outcome. */
export async function requestRevalidation(
  env: PublishEnv,
  input: { paths?: string[]; tags?: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!env.revalidateSecret) return { ok: false, error: "REVALIDATE_SECRET is not set" };
  try {
    const res = await fetchImpl(`${env.siteUrl.replace(/\/$/, "")}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.revalidateSecret}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/** Notifies IndexNow (Bing, Yandex, Seznam...) of new or updated URLs (FR-WEB-4). */
export async function pingIndexNow(
  env: PublishEnv,
  urls: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!env.indexNowKey) return { ok: false, error: "No IndexNow key" };
  const site = new URL(env.siteUrl);
  if (site.hostname === "localhost") return { ok: false, error: "Skipped for localhost" };
  try {
    const res = await fetchImpl("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: site.hostname,
        key: env.indexNowKey,
        keyLocation: `${site.origin}/${env.indexNowKey}.txt`,
        urlList: urls,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok || res.status === 202, status: res.status };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/** Side effects after publishing: revalidate pages and ping IndexNow for the article URL. */
export async function afterPublish(db: DbOrTx, articleId: string, env: PublishEnv, fetchImpl: typeof fetch = fetch) {
  const paths = await pathsForArticle(db, articleId);
  const revalidate = await requestRevalidation(env, { paths }, fetchImpl);
  const indexNow = await pingIndexNow(env, [`${env.siteUrl.replace(/\/$/, "")}${paths[0]}`], fetchImpl);
  return { paths, revalidate, indexNow };
}

/** Publishes scheduled articles whose time has come (cron). Failures are reported, not thrown. */
export async function publishDueArticles(
  db: DbOrTx,
  env: PublishEnv,
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
) {
  const due = await dueScheduledArticles(db, now);
  const results: Array<{ articleId: string; ok: boolean; error?: string }> = [];
  for (const { id } of due) {
    try {
      await publishArticle(db, id, { now });
      await afterPublish(db, id, env, fetchImpl);
      results.push({ articleId: id, ok: true });
    } catch (error) {
      results.push({ articleId: id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
