import { articleText, type ArticleBody } from "@repo/content";
import { and, articleVersions, articles, categories, desc, eq, isNull, ne, products, sql, type DbOrTx } from "@repo/db";

/**
 * Site search (FR-WEB-7). Live articles of every type are matched through the generated, GIN-indexed
 * `articles.search_tsv` (title weight A, `search_text` weight B), plus a product name/tagline
 * substring match so brand names that stem oddly still hit. `search_text` is refreshed on publish.
 */

export const SEARCH_TYPES = ["review", "comparison", "alternatives", "best_of"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

const MAX_SEARCH_TEXT = 20_000;

export interface SearchTextInput {
  productName?: string | null;
  productTagline?: string | null;
  categoryName?: string | null;
  seoTitle?: string | null;
  metaDescription?: string | null;
  blocks: ArticleBody;
}

/** Plain text indexed for an article (weight B): names, SEO copy, headings, verdict, then the body. */
export function buildSearchText(input: SearchTextInput): string {
  const headings = input.blocks.flatMap((b) => (b.type === "heading" ? [b.text] : []));
  const verdict = input.blocks.flatMap((b) => (b.type === "verdict" ? [b.summary] : []));
  const head = [
    input.productName,
    input.productTagline,
    input.categoryName,
    input.seoTitle,
    input.metaDescription,
    ...headings,
    ...verdict,
  ]
    .filter((s): s is string => !!s?.trim())
    .join("\n");
  return `${head}\n${articleText(input.blocks)}`.slice(0, MAX_SEARCH_TEXT);
}

const live = () => and(sql`${articles.publishedVersionId} is not null`, ne(articles.status, "archived"));

/** Recomputes `search_text` from the published version (null when nothing is published). */
export async function refreshArticleSearchText(db: DbOrTx, articleId: string): Promise<string | null> {
  const [row] = await db
    .select({
      blocks: articleVersions.blocks,
      seo: articleVersions.seo,
      productName: products.name,
      productTagline: products.tagline,
      categoryName: categories.name,
    })
    .from(articles)
    .leftJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .leftJoin(products, eq(products.id, articles.productId))
    .leftJoin(categories, sql`${categories.id} = coalesce(${articles.categoryId}, ${products.categoryId})`)
    .where(eq(articles.id, articleId))
    .limit(1);
  const text = row?.blocks
    ? buildSearchText({
        productName: row.productName,
        productTagline: row.productTagline,
        categoryName: row.categoryName,
        seoTitle: row.seo?.title,
        metaDescription: row.seo?.metaDescription,
        blocks: row.blocks,
      })
    : null;
  await db.update(articles).set({ searchText: text }).where(eq(articles.id, articleId));
  return text;
}

/** Fills `search_text` for live articles that have none yet (articles published before search existed). */
export async function backfillSearchText(db: DbOrTx, limit = 500): Promise<number> {
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(live(), isNull(articles.searchText)))
    .limit(limit);
  for (const r of rows) await refreshArticleSearchText(db, r.id);
  return rows.length;
}

export interface SearchOptions {
  q: string;
  categorySlug?: string | null;
  type?: SearchType | null;
  limit?: number;
  offset?: number;
  /** Content locale searched (phase 3); defaults to English. */
  locale?: string | null;
}

/** Text-search configuration per locale; must match the `articles.search_tsv` generated column. */
export function searchConfigFor(locale: string | null | undefined): "german" | "english" {
  return locale === "de" ? "german" : "english";
}

/** Escapes LIKE wildcards in user input. */
export function likePattern(q: string): string {
  return `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

export type SearchHit = Awaited<ReturnType<typeof searchSite>>[number];

export async function searchSite(db: DbOrTx, opts: SearchOptions) {
  const q = opts.q.trim().slice(0, 200);
  if (!q) return [];
  const locale = opts.locale || "en";
  const query = sql`websearch_to_tsquery(${searchConfigFor(locale)}::regconfig, ${q})`;
  const pattern = likePattern(q);
  // Candidate ids: the GIN-indexed full-text branch, unioned with product-name hits.
  const candidates = sql`(
    select ${articles.id} from ${articles} where ${articles.searchTsv} @@ ${query} and ${articles.locale} = ${locale}
    union
    select ${articles.id} from ${articles} join ${products} on ${products.id} = ${articles.productId}
    where ${articles.locale} = ${locale}
      and (${products.name} ilike ${pattern} or ${products.tagline} ilike ${pattern}
        or ${products.translations} -> ${locale} ->> 'tagline' ilike ${pattern})
  )`;
  const nameHit = sql`(${products.name} ilike ${pattern})`;
  const rank = sql<number>`(ts_rank(${articles.searchTsv}, ${query}) + case when ${nameHit} then 1 else 0 end)::real`;
  return db
    .select({
      id: articles.id,
      type: articles.type,
      slug: articles.slug,
      title: articles.title,
      publishedAt: articles.publishedAt,
      updatedAt: articles.updatedAt,
      lastVerifiedAt: articles.lastVerifiedAt,
      overallScore: articleVersions.overallScore,
      metaDescription: sql<string | null>`${articleVersions.seo} ->> 'metaDescription'`,
      ogImageAssetId: sql<string | null>`${articleVersions.seo} ->> 'ogImageAssetId'`,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      productTagline: sql<
        string | null
      >`coalesce(nullif(${products.translations} -> ${locale} ->> 'tagline', ''), ${products.tagline})`,
      logoAssetId: products.logoAssetId,
      categorySlug: categories.slug,
      categoryName: sql<
        string | null
      >`coalesce(nullif(${categories.translations} -> ${locale} ->> 'name', ''), ${categories.name})`,
      rank,
    })
    .from(articles)
    .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .leftJoin(products, eq(products.id, articles.productId))
    .leftJoin(categories, sql`${categories.id} = coalesce(${articles.categoryId}, ${products.categoryId})`)
    .where(
      and(
        live(),
        eq(articles.locale, locale),
        sql`${articles.id} in ${candidates}`,
        opts.type ? eq(articles.type, opts.type) : undefined,
        opts.categorySlug ? eq(categories.slug, opts.categorySlug) : undefined,
      ),
    )
    .orderBy(desc(rank), desc(articles.publishedAt))
    .limit(Math.min(opts.limit ?? 20, 50))
    .offset(opts.offset ?? 0);
}
