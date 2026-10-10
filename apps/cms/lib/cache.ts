import { pathsForArticle, publishEnvFromProcess, requestRevalidation } from "@repo/core";
import { and, articles, eq, getDb, goSlugs, ne, sql } from "@repo/db";
import { Redis } from "@upstash/redis";

let redis: Redis | null | undefined;
function getRedis() {
  if (redis === undefined) {
    const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
    redis = url && token ? new Redis({ url, token }) : null;
  }
  return redis;
}

/**
 * After a program/link change: drop the cached go-link table (web reads it within 60 s, FR-AFF-8)
 * and revalidate the product's live review, whose CTAs may switch between /go and direct links.
 */
export async function invalidateProductLinks(productId: string) {
  const db = getDb();
  const slugs = await db.select({ slug: goSlugs.slug }).from(goSlugs).where(eq(goSlugs.productId, productId));
  const r = getRedis();
  if (r && slugs.length) await r.del(...slugs.map((s) => `golink:v1:${s.slug}`)).catch(() => {});
  const live = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        eq(articles.productId, productId),
        sql`${articles.publishedVersionId} is not null`,
        ne(articles.status, "archived"),
      ),
    );
  for (const a of live) await revalidateArticle(a.id);
}

/** Revalidates an article's pages on the public site (FR-WEB-2). */
export async function revalidateArticle(articleId: string) {
  const paths = await pathsForArticle(getDb(), articleId);
  return requestRevalidation(publishEnvFromProcess(), { paths });
}
