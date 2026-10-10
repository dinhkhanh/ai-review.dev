import { and, count, desc, eq, inArray, products, productSuggestions, sql, type DbOrTx } from "@repo/db";
import { DomainError } from "./errors";
import { createReviewJob } from "./jobs";
import { findProductByDomain } from "./products";
import { normalizeWebsiteUrl, registrableDomain } from "./url";

export type SuggestionStatus = (typeof productSuggestions.status.enumValues)[number];

export interface SuggestionInput {
  name: string;
  url: string;
  categorySlug?: string | null;
  /** Where the candidate came from: producthunt, hackernews, manual... */
  source: string;
  /** Expected-value score (FR-INT-7); higher ranks first. */
  score: number;
  /** Evidence and score components, rendered in the CMS queue. */
  signals: Record<string, unknown>;
}

/** Registrable domains among `domains` that are already products or suggestions (any status). */
export async function knownDomains(db: DbOrTx, domains: string[]): Promise<Set<string>> {
  const unique = [...new Set(domains.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const [p, s] = await Promise.all([
    db.select({ domain: products.domain }).from(products).where(inArray(products.domain, unique)),
    db
      .select({ domain: productSuggestions.domain })
      .from(productSuggestions)
      .where(inArray(productSuggestions.domain, unique)),
  ]);
  return new Set([...p, ...s].map((r) => r.domain));
}

/**
 * Inserts a suggestion, or refreshes the evidence of one still in the queue (status `new`).
 * Accepted and dismissed suggestions are never resurrected by a later sourcing run.
 */
export async function upsertSuggestion(db: DbOrTx, input: SuggestionInput) {
  const url = normalizeWebsiteUrl(input.url);
  const domain = registrableDomain(url);
  const values = {
    name: input.name.trim().slice(0, 120),
    url,
    domain,
    categorySlug: input.categorySlug ?? null,
    source: input.source,
    score: input.score.toFixed(3),
    signals: input.signals,
  };
  const [existing] = await db.select().from(productSuggestions).where(eq(productSuggestions.domain, domain)).limit(1);
  if (!existing) {
    const [row] = await db.insert(productSuggestions).values(values).onConflictDoNothing().returning();
    return { suggestion: row ?? null, created: !!row };
  }
  if (existing.status !== "new") return { suggestion: existing, created: false };
  const [row] = await db
    .update(productSuggestions)
    .set(values)
    .where(eq(productSuggestions.id, existing.id))
    .returning();
  return { suggestion: row!, created: false };
}

export async function getSuggestion(db: DbOrTx, id: string) {
  const [row] = await db.select().from(productSuggestions).where(eq(productSuggestions.id, id)).limit(1);
  return row ?? null;
}

/** The CMS "Suggested products" queue: highest expected value first. */
export async function listSuggestions(
  db: DbOrTx,
  opts: { status?: SuggestionStatus; categorySlug?: string; limit?: number } = {},
) {
  return db
    .select()
    .from(productSuggestions)
    .where(
      and(
        opts.status ? eq(productSuggestions.status, opts.status) : undefined,
        opts.categorySlug ? eq(productSuggestions.categorySlug, opts.categorySlug) : undefined,
      ),
    )
    .orderBy(
      sql`case when ${productSuggestions.status} = 'new' then 0 else 1 end`,
      desc(productSuggestions.score),
      desc(productSuggestions.createdAt),
    )
    .limit(Math.min(opts.limit ?? 100, 500));
}

export async function suggestionCounts(db: DbOrTx): Promise<Record<SuggestionStatus, number>> {
  const rows = await db
    .select({ status: productSuggestions.status, n: count() })
    .from(productSuggestions)
    .groupBy(productSuggestions.status);
  const out: Record<SuggestionStatus, number> = { new: 0, accepted: 0, dismissed: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/**
 * Accepts a suggestion into a review job (FR-INT-7 "one click into a job"). If the product already
 * exists (added since the suggestion was made), the job refreshes it instead. The caller dispatches.
 */
export async function acceptSuggestion(db: DbOrTx, id: string, userId?: string | null) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(productSuggestions).where(eq(productSuggestions.id, id)).for("update");
    if (!s) throw new DomainError("not_found", `Suggestion ${id} not found`);
    if (s.status === "accepted") throw new DomainError("conflict", "Suggestion was already accepted");
    const existing = await findProductByDomain(tx, s.domain);
    const job = await createReviewJob(tx, {
      preset: existing ? "refresh" : "quick_review",
      productId: existing?.id ?? null,
      requestedByUserId: userId ?? null,
      input: {
        url: s.url,
        name: s.name,
        categorySlug: s.categorySlug,
        keywords: [],
        angle: null,
        competitors: [],
        suggestionId: s.id,
        ...(existing ? { productId: existing.id } : {}),
      },
    });
    await tx.update(productSuggestions).set({ status: "accepted", jobId: job.id }).where(eq(productSuggestions.id, id));
    return job;
  });
}

export async function setSuggestionStatus(db: DbOrTx, id: string, status: Exclude<SuggestionStatus, "accepted">) {
  const [row] = await db
    .update(productSuggestions)
    .set({ status })
    .where(and(eq(productSuggestions.id, id), sql`${productSuggestions.status} <> 'accepted'`))
    .returning();
  if (!row) throw new DomainError("invalid", "Suggestion not found or already accepted");
  return row;
}
