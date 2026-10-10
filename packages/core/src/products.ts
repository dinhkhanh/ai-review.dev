import { slugify } from "@repo/content";
import { and, desc, eq, products, type DbOrTx } from "@repo/db";
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
