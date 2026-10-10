import { DEFAULT_CONTENT_LOCALE, localizedArticlePath, type ArticleBody } from "@repo/content";
import {
  and,
  articleVersions,
  articles,
  asc,
  authors,
  categories,
  count,
  desc,
  eq,
  goSlugs,
  inArray,
  mediaAssets,
  or,
  ne,
  productSources,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { listCompetitors } from "./products";
import { latestFactSheet } from "./fact-sheets";

/**
 * Read models for the public web app and API. An article is live once it has a published version
 * and is not archived; edits in review keep the published version on the site (C-6).
 */
const isLive = () => and(sql`${articles.publishedVersionId} is not null`, ne(articles.status, "archived"));

/**
 * Locales (phase 3): articles exist per locale; products and categories are shared and carry
 * per-locale overrides in `translations` ({ de: { name, description, tagline } }). Every public
 * read takes a locale (default English) and only returns that locale's articles.
 */
const loc = (locale: string | null | undefined) => locale || DEFAULT_CONTENT_LOCALE;

type Column = Parameters<typeof sql>[1];

/** A translated field with the shared (English) column as fallback. */
const translated = (column: Column, translations: Column, locale: string, key: string) =>
  sql<string>`coalesce(nullif(${translations} -> ${locale} ->> ${key}, ''), ${column})`;
const translatedNullable = (column: Column, translations: Column, locale: string, key: string) =>
  sql<string | null>`coalesce(nullif(${translations} -> ${locale} ->> ${key}, ''), ${column})`;

/** Applies `translations[locale]` to a category or product row read with `select()`. */
export function localizeRow<T extends { translations?: unknown }>(row: T, locale: string | null | undefined): T {
  const l = loc(locale);
  const overrides = (row.translations as Record<string, Record<string, string>> | undefined)?.[l];
  if (!overrides) return row;
  const out: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(overrides)) if (value && key in out) out[key] = value;
  return out as T;
}

const reviewCard = (locale: string) => ({
  id: articles.id,
  locale: articles.locale,
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
  productTagline: translatedNullable(products.tagline, products.translations, locale, "tagline"),
  logoAssetId: products.logoAssetId,
  categorySlug: categories.slug,
  categoryName: translatedNullable(categories.name, categories.translations, locale, "name"),
});

export type ReviewCard = Awaited<ReturnType<typeof listPublishedReviews>>[number];

export async function listPublishedReviews(
  db: DbOrTx,
  opts: { categorySlug?: string; authorId?: string; limit?: number; offset?: number; locale?: string | null } = {},
) {
  return db
    .select(reviewCard(loc(opts.locale)))
    .from(articles)
    .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .leftJoin(products, eq(products.id, articles.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        isLive(),
        eq(articles.type, "review"),
        eq(articles.locale, loc(opts.locale)),
        opts.categorySlug ? eq(categories.slug, opts.categorySlug) : undefined,
        opts.authorId ? eq(articles.authorId, opts.authorId) : undefined,
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(Math.min(opts.limit ?? 24, 100))
    .offset(opts.offset ?? 0);
}

export async function countPublishedReviews(db: DbOrTx, opts: { categorySlug?: string; locale?: string | null } = {}) {
  const [row] = await db
    .select({ n: count() })
    .from(articles)
    .leftJoin(products, eq(products.id, articles.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        isLive(),
        eq(articles.type, "review"),
        eq(articles.locale, loc(opts.locale)),
        opts.categorySlug ? eq(categories.slug, opts.categorySlug) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/** Categories with their live review count in `locale`, names localised (falls back to English). */
export async function listCategoriesWithCounts(db: DbOrTx, opts: { locale?: string | null } = {}) {
  const l = loc(opts.locale);
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: translated(categories.name, categories.translations, l, "name"),
      description: translatedNullable(categories.description, categories.translations, l, "description"),
      reviews: sql<number>`count(${articles.id}) filter (where ${articles.publishedVersionId} is not null and ${articles.status} <> 'archived' and ${articles.type} = 'review' and ${articles.locale} = ${l})::int`,
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .leftJoin(articles, eq(articles.productId, products.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.position), asc(categories.name));
}

export async function getCategoryBySlug(db: DbOrTx, slug: string, locale?: string | null) {
  const [row] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  return row ? localizeRow(row, locale) : null;
}

export async function getAuthorBySlug(db: DbOrTx, slug: string) {
  const [row] = await db.select().from(authors).where(eq(authors.slug, slug)).limit(1);
  return row ?? null;
}

export async function listAuthors(db: DbOrTx) {
  return db.select().from(authors).orderBy(asc(authors.name));
}

export async function getDefaultAuthor(db: DbOrTx) {
  const [row] = await db.select().from(authors).orderBy(asc(authors.createdAt)).limit(1);
  return row ?? null;
}

function collectAssetIds(blocks: ArticleBody): string[] {
  return blocks.flatMap((b) => (b.type === "image" ? [b.assetId] : []));
}

function collectSourceIds(blocks: ArticleBody): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.sourceId === "string") ids.add(obj.sourceId);
      Object.values(obj).forEach(visit);
    }
  };
  visit(blocks);
  return [...ids];
}

/**
 * Everything needed to render one article version on web, in the CMS preview, or through the API:
 * blocks, SEO, product, category, author, fact sheet, referenced media and sources, go-slug and
 * competitors (with links to their published reviews).
 */
export async function loadArticleRenderData(db: DbOrTx, articleId: string, versionId?: string | null) {
  const [article] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
  if (!article) return null;
  const vid = versionId ?? article.currentVersionId;
  if (!vid) return null;
  const [version] = await db.select().from(articleVersions).where(eq(articleVersions.id, vid)).limit(1);
  if (!version || version.articleId !== article.id) return null;

  const [productRow] = article.productId
    ? await db.select().from(products).where(eq(products.id, article.productId)).limit(1)
    : [];
  const product = productRow ? localizeRow(productRow, article.locale) : undefined;
  const categoryId = article.categoryId ?? product?.categoryId ?? null;
  const [categoryRow] = categoryId
    ? await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1)
    : [];
  const category = categoryRow ? localizeRow(categoryRow, article.locale) : undefined;
  const listProducts = article.type === "review" ? [] : await loadListProducts(db, article.productIds, article.locale);
  const [author] = article.authorId
    ? await db.select().from(authors).where(eq(authors.id, article.authorId)).limit(1)
    : [await getDefaultAuthor(db)];
  const assetIds = [
    ...collectAssetIds(version.blocks),
    ...(version.seo?.ogImageAssetId ? [version.seo.ogImageAssetId] : []),
    ...(product?.logoAssetId ? [product.logoAssetId] : []),
  ];
  const media = assetIds.length ? await db.select().from(mediaAssets).where(inArray(mediaAssets.id, assetIds)) : [];
  const sourceIds = collectSourceIds(version.blocks);
  const sources = sourceIds.length
    ? await db
        .select({
          id: productSources.id,
          url: productSources.url,
          title: productSources.title,
          kind: productSources.kind,
          fetchedAt: productSources.fetchedAt,
          createdAt: productSources.createdAt,
        })
        .from(productSources)
        .where(inArray(productSources.id, sourceIds))
        .orderBy(asc(productSources.createdAt))
    : [];
  const go = product ? (await db.select().from(goSlugs).where(eq(goSlugs.productId, product.id)).limit(1))[0] : null;
  const factSheet = product ? await latestFactSheet(db, product.id) : null;
  const competitorRows = product ? await listCompetitors(db, product.id) : [];
  const competitorReviews = competitorRows.length
    ? await db
        .select({ productId: articles.productId, slug: articles.slug })
        .from(articles)
        .where(
          and(
            inArray(
              articles.productId,
              competitorRows.map((c) => c.productId),
            ),
            isLive(),
            eq(articles.type, "review"),
            eq(articles.locale, article.locale),
          ),
        )
    : [];

  return {
    article,
    version,
    product: product ?? null,
    category: category ?? null,
    author: author ?? null,
    media,
    sources,
    goSlug: go?.slug ?? null,
    factSheet: factSheet?.data ?? null,
    factSheetUpdatedAt: factSheet?.createdAt ?? null,
    /** Comparisons and lists (FR-CON-8): the products in article order, with CTAs and review links. */
    listProducts,
    competitors: competitorRows.map((c) => ({
      ...c,
      reviewSlug: competitorReviews.find((r) => r.productId === c.productId)?.slug ?? null,
    })),
  };
}

export type ArticleRenderData = NonNullable<Awaited<ReturnType<typeof loadArticleRenderData>>>;

type ArticleType = (typeof articles.type.enumValues)[number];

/** Products of a comparison or list, in article order, with go-slug and live review in `locale` (if any). */
async function loadListProducts(db: DbOrTx, ids: string[], locale: string) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      tagline: translatedNullable(products.tagline, products.translations, locale, "tagline"),
      websiteUrl: products.websiteUrl,
      logoAssetId: products.logoAssetId,
      status: products.status,
    })
    .from(products)
    .where(inArray(products.id, ids));
  const [slugs, reviews] = await Promise.all([
    db.select().from(goSlugs).where(inArray(goSlugs.productId, ids)),
    db
      .select({ productId: articles.productId, slug: articles.slug, score: articleVersions.overallScore })
      .from(articles)
      .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
      .where(and(inArray(articles.productId, ids), eq(articles.type, "review"), eq(articles.locale, locale), isLive())),
  ]);
  return ids.flatMap((id) => {
    const p = rows.find((r) => r.id === id);
    if (!p) return [];
    const review = reviews.find((r) => r.productId === id);
    return [
      {
        ...p,
        goSlug: slugs.find((g) => g.productId === id)?.slug ?? null,
        reviewSlug: review?.slug ?? null,
        score: review?.score ?? null,
      },
    ];
  });
}

/**
 * Live articles of any type for index pages, feeds and the home page (FR-WEB-1). The category is
 * the article's own (lists) or its product's (reviews).
 */
export async function listPublishedArticles(
  db: DbOrTx,
  opts: { types?: ArticleType[]; categorySlug?: string; limit?: number; offset?: number; locale?: string | null } = {},
) {
  const l = loc(opts.locale);
  return db
    .select({
      id: articles.id,
      locale: articles.locale,
      type: articles.type,
      slug: articles.slug,
      title: articles.title,
      publishedAt: articles.publishedAt,
      updatedAt: articles.updatedAt,
      lastVerifiedAt: articles.lastVerifiedAt,
      overallScore: articleVersions.overallScore,
      metaDescription: sql<string | null>`${articleVersions.seo} ->> 'metaDescription'`,
      ogImageAssetId: sql<string | null>`${articleVersions.seo} ->> 'ogImageAssetId'`,
      productCount: sql<number>`cardinality(${articles.productIds})`,
      categorySlug: categories.slug,
      categoryName: translatedNullable(categories.name, categories.translations, l, "name"),
    })
    .from(articles)
    .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .leftJoin(products, eq(products.id, articles.productId))
    .leftJoin(categories, sql`${categories.id} = coalesce(${articles.categoryId}, ${products.categoryId})`)
    .where(
      and(
        isLive(),
        eq(articles.locale, l),
        opts.types?.length ? inArray(articles.type, opts.types) : undefined,
        opts.categorySlug ? eq(categories.slug, opts.categorySlug) : undefined,
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(Math.min(opts.limit ?? 24, 100))
    .offset(opts.offset ?? 0);
}

export type ArticleCard = Awaited<ReturnType<typeof listPublishedArticles>>[number];

export async function getPublishedArticleBySlug(
  db: DbOrTx,
  slug: string,
  type: ArticleType = "review",
  locale: string | null = DEFAULT_CONTENT_LOCALE,
) {
  const [row] = await db
    .select({ id: articles.id, publishedVersionId: articles.publishedVersionId })
    .from(articles)
    .where(and(eq(articles.slug, slug), eq(articles.type, type), eq(articles.locale, loc(locale)), isLive()))
    .limit(1);
  return row ? loadArticleRenderData(db, row.id, row.publishedVersionId) : null;
}

/** Id of a live article by slug in a locale (visitor votes and reports post the slug they were on). */
export async function getLiveArticleIdBySlug(db: DbOrTx, slug: string, locale?: string | null) {
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.slug, slug), eq(articles.locale, loc(locale)), isLive()))
    .orderBy(sql`(${articles.type} = 'review') desc`)
    .limit(1);
  return row?.id ?? null;
}

export interface ArticleTranslation {
  locale: string;
  type: ArticleType;
  slug: string;
  /** Site path in its locale, e.g. `/de/reviews/notion-test`. */
  path: string;
}

/**
 * Live versions of one article across locales (hreflang, language switcher, API alternates). The
 * group is the source article plus every article with `translation_of_id` pointing at it.
 */
export async function getArticleTranslations(db: DbOrTx, articleId: string): Promise<ArticleTranslation[]> {
  const [self] = await db
    .select({ id: articles.id, translationOfId: articles.translationOfId })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!self) return [];
  const groupId = self.translationOfId ?? self.id;
  const rows = await db
    .select({ locale: articles.locale, type: articles.type, slug: articles.slug })
    .from(articles)
    .where(and(or(eq(articles.id, groupId), eq(articles.translationOfId, groupId)), isLive()))
    .orderBy(asc(articles.locale), asc(articles.createdAt));
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    if (seen.has(r.locale)) return [];
    seen.add(r.locale);
    return [{ ...r, path: localizedArticlePath(r.type, r.slug, r.locale) }];
  });
}

/**
 * The live article in `toLocale` for the article at (type, slug, fromLocale), for the language
 * switcher. Null when there is no translation (the switcher then goes to the locale home).
 */
export async function findArticleTranslation(
  db: DbOrTx,
  input: { type: ArticleType; slug: string; fromLocale: string; toLocale: string },
): Promise<ArticleTranslation | null> {
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.type, input.type), eq(articles.slug, input.slug), eq(articles.locale, input.fromLocale)))
    .limit(1);
  if (!row) return null;
  return (await getArticleTranslations(db, row.id)).find((t) => t.locale === input.toLocale) ?? null;
}

/**
 * Sitemap rows (FR-WEB-4) for the given locales, with `groupId` (source article id) so the sitemap
 * can emit hreflang alternates between live translations.
 */
export async function publishedSitemapEntries(db: DbOrTx, opts: { locales?: string[] } = {}) {
  const locales = opts.locales?.length ? opts.locales : [DEFAULT_CONTENT_LOCALE];
  return db
    .select({
      type: articles.type,
      slug: articles.slug,
      locale: articles.locale,
      updatedAt: articles.updatedAt,
      groupId: sql<string>`coalesce(${articles.translationOfId}, ${articles.id})`,
    })
    .from(articles)
    .where(and(isLive(), inArray(articles.locale, locales)))
    .orderBy(desc(articles.updatedAt))
    .limit(50_000);
}

/** Lists published reviews for API search: name/title substring match (FR-API-2). */
export async function searchPublishedReviews(db: DbOrTx, q: string, limit = 20, locale?: string | null) {
  const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return db
    .select(reviewCard(loc(locale)))
    .from(articles)
    .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .leftJoin(products, eq(products.id, articles.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        isLive(),
        eq(articles.locale, loc(locale)),
        sql`(${articles.title} ilike ${pattern} or ${products.name} ilike ${pattern})`,
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(Math.min(limit, 50));
}

const reviewedProduct = (locale: string) => ({
  id: products.id,
  slug: products.slug,
  name: products.name,
  tagline: translatedNullable(products.tagline, products.translations, locale, "tagline"),
  websiteUrl: products.websiteUrl,
  logoAssetId: products.logoAssetId,
  categorySlug: categories.slug,
  categoryName: translatedNullable(categories.name, categories.translations, locale, "name"),
  reviewSlug: articles.slug,
  score: articleVersions.overallScore,
});

const liveReviewIn = (locale: string) =>
  and(eq(articles.productId, products.id), eq(articles.type, "review"), eq(articles.locale, locale), isLive());

/** Products that have a live review in `locale` (public API, FR-API-2). */
export async function listReviewedProducts(
  db: DbOrTx,
  opts: { limit?: number; offset?: number; locale?: string | null } = {},
) {
  const l = loc(opts.locale);
  return db
    .select(reviewedProduct(l))
    .from(products)
    .innerJoin(articles, liveReviewIn(l))
    .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .orderBy(asc(products.name))
    .limit(Math.min(opts.limit ?? 50, 100))
    .offset(opts.offset ?? 0);
}

export async function getReviewedProductBySlug(db: DbOrTx, slug: string, locale?: string | null) {
  const l = loc(locale);
  const [row] = await db
    .select(reviewedProduct(l))
    .from(products)
    .innerJoin(articles, liveReviewIn(l))
    .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.slug, slug))
    .limit(1);
  if (!row) return null;
  const [sheet, go] = await Promise.all([
    latestFactSheet(db, row.id),
    db.select().from(goSlugs).where(eq(goSlugs.productId, row.id)).limit(1),
  ]);
  return { ...row, factSheet: sheet?.data ?? null, factSheetAt: sheet?.createdAt ?? null, goSlug: go[0]?.slug ?? null };
}

export async function countReviewedProducts(db: DbOrTx, opts: { locale?: string | null } = {}) {
  const [row] = await db
    .select({ n: count() })
    .from(articles)
    .where(and(eq(articles.type, "review"), eq(articles.locale, loc(opts.locale)), isLive()));
  return row?.n ?? 0;
}
