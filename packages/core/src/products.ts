import { slugify } from "@repo/content";
import { and, asc, competitors, desc, eq, goSlugs, products, type DbOrTx } from "@repo/db";
import { DomainError } from "./errors";
import { normalizeWebsiteUrl, registrableDomain } from "./url";

export interface CreateProductInput {
  name: string;
  websiteUrl: string;
  categoryId?: string | null;
  tagline?: string | null;
  locale?: string;
}

export async function findProductByDomain(db: DbOrTx, urlOrDomain: string, locale = "en") {
  const domain = registrableDomain(urlOrDomain);
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.domain, domain), eq(products.locale, locale)))
    .limit(1);
  return row ?? null;
}

/**
 * Creates a product, refusing duplicates by registrable domain (FR-INT-4). Callers that want
 * "refresh existing" behaviour should call findProductByDomain first.
 */
export async function createProduct(db: DbOrTx, input: CreateProductInput) {
  const websiteUrl = normalizeWebsiteUrl(input.websiteUrl);
  const domain = registrableDomain(websiteUrl);
  const locale = input.locale ?? "en";
  const existing = await findProductByDomain(db, domain, locale);
  if (existing) {
    throw new DomainError("conflict", `Product for ${domain} already exists`, {
      productId: existing.id,
      slug: existing.slug,
    });
  }
  const baseSlug = slugify(input.name) || slugify(domain);
  const slug = await uniqueSlug(db, baseSlug, locale);
  const [row] = await db
    .insert(products)
    .values({
      name: input.name.trim(),
      websiteUrl,
      domain,
      slug,
      locale,
      categoryId: input.categoryId ?? null,
      tagline: input.tagline ?? null,
    })
    .returning();
  return row!;
}

async function uniqueSlug(db: DbOrTx, base: string, locale: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [hit] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.slug, candidate), eq(products.locale, locale)))
      .limit(1);
    if (!hit) return candidate;
  }
  throw new DomainError("conflict", `Could not allocate a unique slug for ${base}`);
}

export async function listProducts(db: DbOrTx, opts: { limit?: number; offset?: number } = {}) {
  return db
    .select()
    .from(products)
    .orderBy(desc(products.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(opts.offset ?? 0);
}

export async function getProduct(db: DbOrTx, id: string) {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return row ?? null;
}

export async function getProductBySlug(db: DbOrTx, slug: string, locale = "en") {
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.slug, slug), eq(products.locale, locale)))
    .limit(1);
  return row ?? null;
}

export type ProductPatch = Partial<
  Pick<
    typeof products.$inferInsert,
    | "name"
    | "tagline"
    | "categoryId"
    | "status"
    | "profile"
    | "logoAssetId"
    | "lastResearchedAt"
    | "refreshIntervalDays"
    | "nextRefreshAt"
    | "discontinuedAt"
    | "statusNote"
    | "websiteUrl"
  >
>;

export async function updateProduct(db: DbOrTx, id: string, patch: ProductPatch) {
  const [row] = await db.update(products).set(patch).where(eq(products.id, id)).returning();
  if (!row) throw new DomainError("not_found", `Product ${id} not found`);
  return row;
}

/** Returns the product for this domain, creating it if needed (FR-INT-4: never a duplicate). */
export async function findOrCreateProduct(db: DbOrTx, input: CreateProductInput) {
  const existing = await findProductByDomain(db, input.websiteUrl, input.locale ?? "en");
  if (existing) return { product: existing, created: false };
  try {
    return { product: await createProduct(db, input), created: true };
  } catch (error) {
    // Lost a race with a concurrent intake for the same domain.
    const raced = await findProductByDomain(db, input.websiteUrl, input.locale ?? "en");
    if (raced) return { product: raced, created: false };
    throw error;
  }
}

/**
 * Every product gets a go-slug equal to its product slug (FR-AFF-6). The fallback is the vendor
 * site, so CTAs work before any affiliate program exists (FR-AFF-5).
 */
export async function ensureGoSlug(db: DbOrTx, product: { id: string; slug: string; websiteUrl: string }) {
  const [existing] = await db.select().from(goSlugs).where(eq(goSlugs.productId, product.id)).limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(goSlugs)
    .values({ slug: product.slug, productId: product.id, fallbackUrl: product.websiteUrl })
    .onConflictDoNothing({ target: goSlugs.slug })
    .returning();
  if (row) return row;
  // Slug taken by another product (renamed products); suffix it.
  const [alt] = await db
    .insert(goSlugs)
    .values({
      slug: `${product.slug}-${product.id.slice(0, 4)}`,
      productId: product.id,
      fallbackUrl: product.websiteUrl,
    })
    .returning();
  return alt!;
}

export async function getGoSlugForProduct(db: DbOrTx, productId: string) {
  const [row] = await db.select().from(goSlugs).where(eq(goSlugs.productId, productId)).limit(1);
  return row ?? null;
}

export async function setCompetitors(
  db: DbOrTx,
  productId: string,
  list: Array<{ competitorProductId: string; relation: "alternative" | "direct"; note: string | null }>,
) {
  await db.transaction(async (tx) => {
    await tx.delete(competitors).where(eq(competitors.productId, productId));
    const rows = list
      .filter((c) => c.competitorProductId !== productId)
      .map((c, position) => ({ productId, ...c, position }));
    if (rows.length) await tx.insert(competitors).values(rows).onConflictDoNothing();
  });
}

export async function listCompetitors(db: DbOrTx, productId: string) {
  return db
    .select({
      productId: products.id,
      slug: products.slug,
      name: products.name,
      websiteUrl: products.websiteUrl,
      tagline: products.tagline,
      status: products.status,
      relation: competitors.relation,
      note: competitors.note,
    })
    .from(competitors)
    .innerJoin(products, eq(products.id, competitors.competitorProductId))
    .where(eq(competitors.productId, productId))
    .orderBy(asc(competitors.position));
}
