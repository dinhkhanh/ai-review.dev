import {
  linkFormatSchema,
  type GoLinkTable,
  type LinkFormat,
  type Network,
  type ProgramStatus,
  type RedirectPolicy,
} from "@repo/affiliate";
import {
  affiliateLinks,
  affiliatePrograms,
  and,
  asc,
  clicks,
  count,
  desc,
  eq,
  goSlugs,
  gte,
  inArray,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { DomainError } from "./errors";

type CommissionModel = (typeof affiliatePrograms.commissionModel.enumValues)[number];
type LinkStatus = (typeof affiliateLinks.status.enumValues)[number];

export interface ProgramInput {
  productId: string;
  network: Network;
  name: string;
  status?: ProgramStatus;
  commissionModel?: CommissionModel;
  commissionValue?: number | null;
  commissionCurrency?: string | null;
  recurringMonths?: number | null;
  cookieDays?: number | null;
  signupUrl?: string | null;
  dashboardUrl?: string | null;
  termsUrl?: string | null;
  linkFormat?: LinkFormat | null;
  redirectPolicy?: RedirectPolicy;
  evidence?: Array<{ url: string; note?: string }>;
  draftApplication?: string | null;
  notes?: string | null;
}

function programValues(input: Partial<ProgramInput>) {
  return {
    ...input,
    commissionValue: input.commissionValue === undefined ? undefined : (input.commissionValue?.toString() ?? null),
    linkFormat:
      input.linkFormat === undefined ? undefined : input.linkFormat ? linkFormatSchema.parse(input.linkFormat) : null,
  };
}

export async function createProgram(db: DbOrTx, input: ProgramInput) {
  const [row] = await db
    .insert(affiliatePrograms)
    .values({ ...programValues(input), productId: input.productId, network: input.network, name: input.name })
    .returning();
  return row!;
}

/**
 * Records a program found by `affiliate_discovery` (FR-AFF-1). Re-discovery refreshes terms but
 * never downgrades a status the admin has moved forward (applied/approved/active...).
 */
export async function upsertDiscoveredProgram(db: DbOrTx, input: ProgramInput) {
  const [existing] = await db
    .select()
    .from(affiliatePrograms)
    .where(and(eq(affiliatePrograms.productId, input.productId), eq(affiliatePrograms.network, input.network)))
    .limit(1);
  if (!existing) return createProgram(db, input);
  const adminOwned = !["not_found", "found"].includes(existing.status);
  const [row] = await db
    .update(affiliatePrograms)
    .set({
      ...programValues({ ...input, status: adminOwned ? existing.status : input.status }),
      // Keep admin-entered link formats and notes.
      linkFormat: existing.linkFormat ?? (input.linkFormat ? linkFormatSchema.parse(input.linkFormat) : null),
      notes: existing.notes ?? input.notes ?? null,
    })
    .where(eq(affiliatePrograms.id, existing.id))
    .returning();
  return row!;
}

export async function updateProgram(db: DbOrTx, id: string, patch: Partial<ProgramInput>) {
  const [current] = await db.select().from(affiliatePrograms).where(eq(affiliatePrograms.id, id)).limit(1);
  if (!current) throw new DomainError("not_found", `Program ${id} not found`);
  const now = new Date();
  const [row] = await db
    .update(affiliatePrograms)
    .set({
      ...programValues(patch),
      ...(patch.status === "applied" && !current.appliedAt ? { appliedAt: now } : {}),
      ...((patch.status === "approved" || patch.status === "active") && !current.approvedAt ? { approvedAt: now } : {}),
    })
    .where(eq(affiliatePrograms.id, id))
    .returning();
  return row!;
}

export async function getProgram(db: DbOrTx, id: string) {
  const [row] = await db.select().from(affiliatePrograms).where(eq(affiliatePrograms.id, id)).limit(1);
  return row ?? null;
}

export async function listPrograms(db: DbOrTx, opts: { productId?: string; statuses?: ProgramStatus[] } = {}) {
  return db
    .select({ program: affiliatePrograms, productName: products.name, productSlug: products.slug })
    .from(affiliatePrograms)
    .innerJoin(products, eq(products.id, affiliatePrograms.productId))
    .where(
      and(
        opts.productId ? eq(affiliatePrograms.productId, opts.productId) : undefined,
        opts.statuses?.length ? inArray(affiliatePrograms.status, opts.statuses) : undefined,
      ),
    )
    .orderBy(desc(affiliatePrograms.updatedAt));
}

export interface LinkInput {
  productId: string;
  programId?: string | null;
  label: string;
  destinationUrl: string;
  region?: string;
  status?: LinkStatus;
  priority?: number;
  weight?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  notes?: string | null;
}

function assertHttpUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") return;
  } catch {
    // fall through
  }
  throw new DomainError("invalid", `Not an http(s) URL: ${url}`);
}

export async function createLink(db: DbOrTx, input: LinkInput) {
  assertHttpUrl(input.destinationUrl);
  const [row] = await db
    .insert(affiliateLinks)
    .values({ ...input, region: (input.region ?? "global").trim() || "global" })
    .returning();
  return row!;
}

export async function updateLink(db: DbOrTx, id: string, patch: Partial<LinkInput>) {
  if (patch.destinationUrl) assertHttpUrl(patch.destinationUrl);
  const [row] = await db.update(affiliateLinks).set(patch).where(eq(affiliateLinks.id, id)).returning();
  if (!row) throw new DomainError("not_found", `Link ${id} not found`);
  return row;
}

export async function deleteLink(db: DbOrTx, id: string) {
  await db.delete(affiliateLinks).where(eq(affiliateLinks.id, id));
}

export async function listLinks(db: DbOrTx, productId: string) {
  return db
    .select()
    .from(affiliateLinks)
    .where(eq(affiliateLinks.productId, productId))
    .orderBy(asc(affiliateLinks.priority), asc(affiliateLinks.createdAt));
}

/** Loads everything the resolver needs for one go-slug (FR-AFF-6). Cached by the web app. */
export async function loadGoLinkTable(db: DbOrTx, slug: string): Promise<GoLinkTable | null> {
  const [go] = await db.select().from(goSlugs).where(eq(goSlugs.slug, slug)).limit(1);
  if (!go) return null;
  const rows = await db
    .select({ link: affiliateLinks, program: affiliatePrograms })
    .from(affiliateLinks)
    .leftJoin(affiliatePrograms, eq(affiliatePrograms.id, affiliateLinks.programId))
    .where(eq(affiliateLinks.productId, go.productId));
  return {
    slug: go.slug,
    productId: go.productId,
    fallbackUrl: go.fallbackUrl,
    links: rows.map(({ link, program }) => ({
      id: link.id,
      destinationUrl: link.destinationUrl,
      region: link.region,
      status: link.status,
      priority: link.priority,
      weight: link.weight,
      startsAt: link.startsAt,
      endsAt: link.endsAt,
      program: program
        ? {
            id: program.id,
            status: program.status,
            network: program.network,
            redirectPolicy: program.redirectPolicy,
            linkFormat: program.linkFormat,
          }
        : null,
    })),
  };
}

export async function goSlugsForProduct(db: DbOrTx, productId: string) {
  return db.select().from(goSlugs).where(eq(goSlugs.productId, productId));
}

export async function setGoSlugFallback(db: DbOrTx, slug: string, fallbackUrl: string) {
  assertHttpUrl(fallbackUrl);
  await db.update(goSlugs).set({ fallbackUrl }).where(eq(goSlugs.slug, slug));
}

export interface ClickInput {
  goSlug: string;
  linkId: string | null;
  articleId?: string | null;
  placement?: string | null;
  path?: string | null;
  country?: string | null;
  device?: string | null;
  ipHash?: string | null;
  uaHash?: string | null;
  isBot: boolean;
  fallback: boolean;
}

/** Click log row (FR-AFF-7). Called after the redirect response is sent. */
export async function recordClick(db: DbOrTx, input: ClickInput) {
  await db.insert(clicks).values({ ...input, path: input.path?.slice(0, 500) ?? null });
}

/** Clicks per day and per placement for the dashboard (FR-CMS-2), humans only. */
export async function clickSummary(db: DbOrTx, since: Date) {
  const human = and(gte(clicks.ts, since), eq(clicks.isBot, false));
  const [total] = await db.select({ n: count() }).from(clicks).where(human);
  const byPlacement = await db
    .select({ placement: clicks.placement, n: count() })
    .from(clicks)
    .where(human)
    .groupBy(clicks.placement)
    .orderBy(desc(count()));
  const bySlug = await db
    .select({ slug: clicks.goSlug, n: count(), fallback: sql<number>`count(*) filter (where ${clicks.fallback})::int` })
    .from(clicks)
    .where(human)
    .groupBy(clicks.goSlug)
    .orderBy(desc(count()))
    .limit(20);
  return { total: total?.n ?? 0, byPlacement, bySlug };
}

export async function recentClicks(db: DbOrTx, limit = 50) {
  return db.select().from(clicks).orderBy(desc(clicks.ts)).limit(Math.min(limit, 500));
}

/** Deletes raw clicks older than the retention window (NFR-8: 13 months; aggregates live elsewhere). */
export async function purgeOldClicks(db: DbOrTx, now = new Date(), months = 13) {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  const deleted = await db
    .delete(clicks)
    .where(sql`${clicks.ts} < ${cutoff.toISOString()}::timestamptz`)
    .returning({ id: clicks.id });
  return deleted.length;
}
