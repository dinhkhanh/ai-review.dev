import {
  affiliatePrograms,
  and,
  articles,
  asc,
  categories,
  deals,
  desc,
  eq,
  goSlugs,
  gt,
  isNull,
  lte,
  ne,
  or,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { DomainError } from "./errors";
import { latestFactSheet } from "./fact-sheets";

/** Deals and coupons (FR-WEB-8): promo codes, trials and guarantees, linked through the go-slug. */

export interface DealInput {
  productId: string;
  programId?: string | null;
  title: string;
  description?: string | null;
  code?: string | null;
  discountText?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  active?: boolean;
  source?: "manual" | "program" | "fact_sheet";
  position?: number;
}

function clean(input: Partial<DealInput>) {
  const out = { ...input };
  if (out.title !== undefined) {
    out.title = out.title.trim().slice(0, 140);
    if (!out.title) throw new DomainError("invalid", "A deal needs a title");
  }
  if (out.code !== undefined) out.code = out.code?.trim().slice(0, 60) || null;
  if (out.discountText !== undefined) out.discountText = out.discountText?.trim().slice(0, 60) || null;
  if (out.description !== undefined) out.description = out.description?.trim().slice(0, 1000) || null;
  if (out.startsAt && out.endsAt && out.endsAt <= out.startsAt) {
    throw new DomainError("invalid", "The deal must end after it starts");
  }
  return out;
}

export async function createDeal(db: DbOrTx, input: DealInput) {
  const [row] = await db
    .insert(deals)
    .values({ ...clean(input), productId: input.productId, title: input.title.trim().slice(0, 140) })
    .returning();
  return row!;
}

export async function updateDeal(db: DbOrTx, id: string, patch: Partial<DealInput>) {
  const [row] = await db.update(deals).set(clean(patch)).where(eq(deals.id, id)).returning();
  if (!row) throw new DomainError("not_found", `Deal ${id} not found`);
  return row;
}

export async function deleteDeal(db: DbOrTx, id: string) {
  await db.delete(deals).where(eq(deals.id, id));
}

export async function getDeal(db: DbOrTx, id: string) {
  const [row] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  return row ?? null;
}

/** All deals for the CMS, newest first. */
export async function listDeals(db: DbOrTx, opts: { productId?: string } = {}) {
  return db
    .select({ deal: deals, productName: products.name, productSlug: products.slug })
    .from(deals)
    .innerJoin(products, eq(products.id, deals.productId))
    .where(opts.productId ? eq(deals.productId, opts.productId) : undefined)
    .orderBy(asc(products.name), asc(deals.position), desc(deals.createdAt));
}

const runningAt = (now: Date) =>
  and(
    eq(deals.active, true),
    or(isNull(deals.startsAt), lte(deals.startsAt, now)),
    or(isNull(deals.endsAt), gt(deals.endsAt, now)),
  );

/**
 * Deals visible on the public site: active, inside their date window, for a product with a live
 * review (so every deal has a review to link to and a go-slug for the CTA).
 */
export async function listActiveDeals(
  db: DbOrTx,
  opts: { categorySlug?: string | null; now?: Date; limit?: number; locale?: string | null } = {},
) {
  const now = opts.now ?? new Date();
  // Deals link to the product's review in the page locale, so only products reviewed in it qualify.
  const locale = opts.locale || "en";
  return db
    .select({
      id: deals.id,
      title: deals.title,
      description: deals.description,
      code: deals.code,
      discountText: deals.discountText,
      endsAt: deals.endsAt,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      logoAssetId: products.logoAssetId,
      reviewSlug: articles.slug,
      goSlug: sql<
        string | null
      >`(select ${goSlugs.slug} from ${goSlugs} where ${goSlugs.productId} = ${products.id} order by ${goSlugs.createdAt} limit 1)`,
      categorySlug: categories.slug,
      categoryName: sql<
        string | null
      >`coalesce(nullif(${categories.translations} -> ${locale} ->> 'name', ''), ${categories.name})`,
    })
    .from(deals)
    .innerJoin(products, eq(products.id, deals.productId))
    .innerJoin(
      articles,
      and(
        eq(articles.productId, products.id),
        eq(articles.type, "review"),
        eq(articles.locale, locale),
        sql`${articles.publishedVersionId} is not null`,
        ne(articles.status, "archived"),
      ),
    )
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(runningAt(now), opts.categorySlug ? eq(categories.slug, opts.categorySlug) : undefined))
    .orderBy(asc(categories.position), asc(products.name), asc(deals.position))
    .limit(Math.min(opts.limit ?? 200, 500));
}

export type ActiveDeal = Awaited<ReturnType<typeof listActiveDeals>>[number];

/** Active deals for one product (review page box). */
export async function dealsForProduct(db: DbOrTx, productId: string, now = new Date()) {
  return db
    .select()
    .from(deals)
    .where(and(eq(deals.productId, productId), runningAt(now)))
    .orderBy(asc(deals.position), desc(deals.createdAt));
}

/** Promo code in program notes, e.g. "Coupon: SAVE20" or "promo code AIREVIEW30". */
const CODE_RE = /\b(?:coupon|promo(?:\s*code)?|discount\s*code|code)\s*[:=]?\s*([A-Z0-9][A-Z0-9_-]{2,30})\b/;
const PERCENT_RE = /(\d{1,2})\s*%\s*off/i;

export interface DealSuggestion {
  title: string;
  discountText: string | null;
  code: string | null;
  source: "fact_sheet" | "program";
  programId: string | null;
}

/** Deterministic deal drafts from fact-sheet terms and program notes (pure; see suggestDealsFromFactSheet). */
export function dealSuggestions(input: {
  productName: string;
  freeTrialDays?: number | null;
  freePlan?: boolean | null;
  moneyBackDays?: number | null;
  programs?: Array<{ id: string; notes: string | null }>;
}): DealSuggestion[] {
  const out: DealSuggestion[] = [];
  const name = input.productName;
  if (input.freeTrialDays && input.freeTrialDays > 0) {
    out.push({
      title: `${name}: ${input.freeTrialDays}-day free trial`,
      discountText: `${input.freeTrialDays}-day free trial`,
      code: null,
      source: "fact_sheet",
      programId: null,
    });
  }
  if (input.freePlan) {
    out.push({
      title: `${name}: free plan`,
      discountText: "Free plan",
      code: null,
      source: "fact_sheet",
      programId: null,
    });
  }
  if (input.moneyBackDays && input.moneyBackDays > 0) {
    out.push({
      title: `${name}: ${input.moneyBackDays}-day money-back guarantee`,
      discountText: `${input.moneyBackDays}-day money-back`,
      code: null,
      source: "fact_sheet",
      programId: null,
    });
  }
  for (const p of input.programs ?? []) {
    const code = p.notes ? CODE_RE.exec(p.notes)?.[1] : undefined;
    if (!code) continue;
    const pct = PERCENT_RE.exec(p.notes!)?.[1];
    out.push({
      title: pct ? `${name}: ${pct}% off with code ${code}` : `${name}: discount code ${code}`,
      discountText: pct ? `${pct}% off` : "Promo code",
      code,
      source: "program",
      programId: p.id,
    });
  }
  return out;
}

/**
 * Creates inactive draft deals from the latest fact sheet (trial, free plan, money-back) and from
 * promo codes in program notes. Skips titles the product already has. The editor activates them.
 */
export async function suggestDealsFromFactSheet(db: DbOrTx, productId: string) {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) throw new DomainError("not_found", `Product ${productId} not found`);
  const [sheet, programs, existing] = await Promise.all([
    latestFactSheet(db, productId),
    db
      .select({ id: affiliatePrograms.id, notes: affiliatePrograms.notes })
      .from(affiliatePrograms)
      .where(eq(affiliatePrograms.productId, productId)),
    db.select({ title: deals.title }).from(deals).where(eq(deals.productId, productId)),
  ]);
  const pricing = sheet?.data.pricing;
  const have = new Set(existing.map((d) => d.title.toLowerCase()));
  const created = [];
  for (const s of dealSuggestions({
    productName: product.name,
    freeTrialDays: pricing?.freeTrialDays?.value ?? null,
    freePlan: pricing?.freePlan?.value ?? null,
    moneyBackDays: pricing?.moneyBackDays?.value ?? null,
    programs,
  })) {
    if (have.has(s.title.toLowerCase())) continue;
    created.push(await createDeal(db, { productId, ...s, active: false }));
  }
  return created;
}
