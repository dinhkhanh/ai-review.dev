import {
  and,
  articles,
  articleVersions,
  asc,
  categories,
  eq,
  factSheets,
  inArray,
  ne,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";

type DerivativeType = "comparison" | "alternatives" | "best_of";

/**
 * Products that can appear in comparisons and lists (FR-CON-8): they have a fact sheet. Includes
 * the latest fact-sheet date and the live review, if any, for the CMS picker and internal links.
 */
export async function listResearchedProducts(db: DbOrTx, opts: { categoryId?: string | null; ids?: string[] } = {}) {
  return db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      tagline: products.tagline,
      websiteUrl: products.websiteUrl,
      status: products.status,
      categoryId: products.categoryId,
      categoryName: categories.name,
      categorySlug: categories.slug,
      factSheetAt:
        sql<Date>`(select max(${factSheets.createdAt}) from ${factSheets} where ${factSheets.productId} = ${products.id})`.mapWith(
          (v: string | Date) => new Date(v),
        ),
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        sql`exists (select 1 from ${factSheets} where ${factSheets.productId} = ${products.id})`,
        ne(products.status, "archived"),
        opts.categoryId ? eq(products.categoryId, opts.categoryId) : undefined,
        opts.ids?.length ? inArray(products.id, opts.ids) : undefined,
      ),
    )
    .orderBy(asc(products.name));
}

/** Live review per product (slug, score), for internal links and list ordering. */
export async function liveReviewsForProducts(db: DbOrTx, productIds: string[]) {
  if (productIds.length === 0) return [];
  return db
    .select({
      productId: articles.productId,
      articleId: articles.id,
      slug: articles.slug,
      title: articles.title,
      score: articleVersions.overallScore,
    })
    .from(articles)
    .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .where(and(eq(articles.type, "review"), inArray(articles.productId, productIds), ne(articles.status, "archived")));
}

/**
 * The existing article for the same derivative, so a re-run adds a version instead of a duplicate:
 * a comparison of the same set of products, alternatives to the same product, or a best-of list
 * with the same slug.
 */
export async function findDerivativeArticle(
  db: DbOrTx,
  input: { type: DerivativeType; productIds: string[]; referenceProductId?: string | null; slug?: string | null },
) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!input.productIds.every((id) => UUID.test(id))) throw new Error("productIds must be UUIDs");
  const where =
    input.type === "comparison"
      ? and(
          sql`${articles.productIds} @> ${sql.raw(`'{${input.productIds.join(",")}}'::uuid[]`)}`,
          sql`${articles.productIds} <@ ${sql.raw(`'{${input.productIds.join(",")}}'::uuid[]`)}`,
        )
      : input.type === "alternatives"
        ? eq(articles.productId, input.referenceProductId ?? "00000000-0000-0000-0000-000000000000")
        : eq(articles.slug, input.slug ?? "");
  const [row] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.type, input.type), where))
    .orderBy(asc(articles.createdAt))
    .limit(1);
  return row ?? null;
}
