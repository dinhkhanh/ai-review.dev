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
import { notify } from "./notifications";
import { getSetting } from "./settings";

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

/** Catch-all network config from settings, or null when disabled/incomplete (FR-AFF-5, D-4). */
export async function catchAllConfig(db: DbOrTx): Promise<GoLinkTable["catchAll"]> {
  const setting = await getSetting(db, "affiliate.catchAllFallback");
  const publisherId = setting?.publisherId?.trim();
  return setting?.enabled && setting.network && publisherId ? { network: setting.network, publisherId } : null;
}

/** Loads everything the resolver needs for one go-slug (FR-AFF-6). Cached by the web app. */
export async function loadGoLinkTable(db: DbOrTx, slug: string): Promise<GoLinkTable | null> {
  const [go] = await db.select().from(goSlugs).where(eq(goSlugs.slug, slug)).limit(1);
  if (!go) return null;
  const [rows, catchAll] = await Promise.all([
    db
      .select({ link: affiliateLinks, program: affiliatePrograms })
      .from(affiliateLinks)
      .leftJoin(affiliatePrograms, eq(affiliatePrograms.id, affiliateLinks.programId))
      .where(eq(affiliateLinks.productId, go.productId)),
    catchAllConfig(db),
  ]);
  return {
    slug: go.slug,
    productId: go.productId,
    fallbackUrl: go.fallbackUrl,
    catchAll,
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

/** ISO-8601 week label, e.g. "2026-W41", for weekly notification dedupe. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Program status reminders (FR-CMS-8): applications still "applied" after `days` get a weekly nudge
 * to chase the network or record the decision.
 */
export async function remindStaleApplications(db: DbOrTx, opts: { now?: Date; days?: number } = {}) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.days ?? 14) * 86_400_000);
  const stale = await db
    .select({ program: affiliatePrograms, productName: products.name })
    .from(affiliatePrograms)
    .innerJoin(products, eq(products.id, affiliatePrograms.productId))
    .where(
      and(
        eq(affiliatePrograms.status, "applied"),
        sql`coalesce(${affiliatePrograms.appliedAt}, ${affiliatePrograms.updatedAt}) < ${cutoff.toISOString()}::timestamptz`,
      ),
    );
  const week = isoWeek(now);
  let sent = 0;
  for (const { program, productName } of stale) {
    const since = program.appliedAt ?? program.updatedAt;
    const days = Math.floor((now.getTime() - since.getTime()) / 86_400_000);
    const row = await notify(db, {
      event: "program.reminder",
      title: `Still waiting on ${program.name} (${productName}): applied ${days} days ago`,
      body: `Check the ${program.network} dashboard and set the program to approved, active or rejected.${
        program.dashboardUrl ? `\n${program.dashboardUrl}` : ""
      }`,
      href: `/products/${program.productId}`,
      entityType: "affiliate_program",
      entityId: program.id,
      dedupeKey: `program.reminder:${program.id}:${week}`,
    });
    if (row) sent++;
  }
  return { stale: stale.length, sent };
}

/** All affiliate links with their last health check, failing ones first (FR-AFF-10, CMS). */
export async function listLinkHealth(db: DbOrTx) {
  return db
    .select({
      id: affiliateLinks.id,
      productId: affiliateLinks.productId,
      productName: products.name,
      label: affiliateLinks.label,
      status: affiliateLinks.status,
      destinationUrl: affiliateLinks.destinationUrl,
      finalUrl: affiliateLinks.finalUrl,
      healthDetail: affiliateLinks.healthDetail,
      healthFailures: affiliateLinks.healthFailures,
      lastHealthCheckAt: affiliateLinks.lastHealthCheckAt,
    })
    .from(affiliateLinks)
    .innerJoin(products, eq(products.id, affiliateLinks.productId))
    .orderBy(
      sql`case when ${affiliateLinks.status} = 'broken' then 0 when ${affiliateLinks.healthFailures} > 0 then 1 else 2 end`,
      asc(products.name),
    )
    .limit(1000);
}
