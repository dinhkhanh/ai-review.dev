import {
  affiliateExperiments,
  affiliateLinks,
  affiliatePrograms,
  and,
  desc,
  eq,
  inArray,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { recordAudit } from "./audit";
import { DomainError } from "./errors";
import { getSetting } from "./settings";

/**
 * A/B offers (FR-AFF-13). An experiment groups two or more links of one product in one region at
 * the same priority; the go-link resolver splits their traffic by weight and tags each click with
 * the experiment and each SubID with the variant (`--v<link>`), so conversions attribute to it.
 *
 * Lifecycle:
 * - start: the links get the lowest of their priorities, the given weights and `experiment_id`.
 * - stop: measurement ends without a winner; links keep their weights until edited.
 * - complete: the winner keeps its priority and weight; the other variants are paused (not
 *   deleted, so they can be reused), which sends all traffic to the winner.
 * Links keep `experiment_id` after the test ends (membership); only running experiments tag clicks.
 */

export type ExperimentStatus = (typeof affiliateExperiments.status.enumValues)[number];

/** Default policy when the setting is missing (mirrors the seed). */
export const DEFAULT_EXPERIMENT_POLICY = { minClicksPerVariant: 200, confidence: 0.95 };

/** Conversions reported up to this long after an experiment ends still count (cookie windows). */
export const EXPERIMENT_CONVERSION_GRACE_DAYS = 30;

export interface StartExperimentInput {
  productId: string;
  name: string;
  linkIds: string[];
  /** Traffic weights by link id; missing links get an equal share (100). */
  weights?: Record<string, number>;
  notes?: string | null;
  userId?: string | null;
}

export async function startExperiment(db: DbOrTx, input: StartExperimentInput) {
  const ids = [...new Set(input.linkIds)];
  if (ids.length < 2) throw new DomainError("invalid", "Pick at least two links to test against each other");
  const name = input.name.trim();
  if (!name) throw new DomainError("invalid", "Give the experiment a name");
  const all = await db
    .select({ link: affiliateLinks, program: affiliatePrograms, experimentStatus: affiliateExperiments.status })
    .from(affiliateLinks)
    .leftJoin(affiliatePrograms, eq(affiliatePrograms.id, affiliateLinks.programId))
    .leftJoin(affiliateExperiments, eq(affiliateExperiments.id, affiliateLinks.experimentId))
    .where(eq(affiliateLinks.productId, input.productId));
  const chosen = all.filter((r) => ids.includes(r.link.id));
  if (chosen.length !== ids.length) throw new DomainError("invalid", "Every link must belong to this product");
  for (const { link, program, experimentStatus } of chosen) {
    if (link.status !== "active") throw new DomainError("invalid", `“${link.label}” is not active`);
    if (experimentStatus === "running") {
      throw new DomainError("conflict", `“${link.label}” is already in a running experiment`);
    }
    // Direct links bypass /go (C-2), so the redirect could never split their traffic.
    if (program?.redirectPolicy === "forbidden") {
      throw new DomainError("invalid", `“${link.label}” belongs to a program that forbids redirects`);
    }
    if (program && program.status !== "active") {
      throw new DomainError("invalid", `“${link.label}” belongs to a program that is not active`);
    }
  }
  const regions = new Set(chosen.map((r) => r.link.region.toLowerCase()));
  if (regions.size > 1) throw new DomainError("invalid", "All variants must target the same region");
  const priority = Math.min(...chosen.map((r) => r.link.priority));
  const region = chosen[0]!.link.region.toLowerCase();
  // Another active link at the same or a better priority would take or dilute the traffic.
  const rival = all.find(
    (r) =>
      !ids.includes(r.link.id) &&
      r.link.status === "active" &&
      r.link.region.toLowerCase() === region &&
      r.link.priority <= priority &&
      r.program?.redirectPolicy !== "forbidden",
  );
  if (rival) {
    throw new DomainError(
      "conflict",
      `“${rival.link.label}” has priority ${rival.link.priority} in the same region; include it or give it a higher number than ${priority}`,
    );
  }
  for (const [id, w] of Object.entries(input.weights ?? {})) {
    if (!ids.includes(id) || !Number.isInteger(w) || w < 1 || w > 10_000) {
      throw new DomainError("invalid", "Weights must be whole numbers from 1 to 10000");
    }
  }

  const [experiment] = await db
    .insert(affiliateExperiments)
    .values({
      productId: input.productId,
      name,
      notes: input.notes ?? null,
      createdByUserId: input.userId ?? null,
    })
    .returning();
  for (const id of ids) {
    await db
      .update(affiliateLinks)
      .set({ experimentId: experiment!.id, priority, weight: input.weights?.[id] ?? 100 })
      .where(eq(affiliateLinks.id, id));
  }
  await recordAudit(db, {
    actorUserId: input.userId,
    action: "experiment.start",
    entityType: "affiliate_experiment",
    entityId: experiment!.id,
    data: { productId: input.productId, linkIds: ids, priority, weights: input.weights ?? {} },
  });
  return experiment!;
}

async function requireExperiment(db: DbOrTx, id: string) {
  const [row] = await db.select().from(affiliateExperiments).where(eq(affiliateExperiments.id, id)).limit(1);
  if (!row) throw new DomainError("not_found", `Experiment ${id} not found`);
  return row;
}

/** Ends measurement without a winner; traffic keeps splitting by weight until links are edited. */
export async function stopExperiment(db: DbOrTx, id: string, opts: { userId?: string | null; now?: Date } = {}) {
  const exp = await requireExperiment(db, id);
  if (exp.status !== "running") throw new DomainError("conflict", "This experiment is not running");
  const [row] = await db
    .update(affiliateExperiments)
    .set({ status: "stopped", endedAt: opts.now ?? new Date() })
    .where(eq(affiliateExperiments.id, id))
    .returning();
  await recordAudit(db, {
    actorUserId: opts.userId,
    action: "experiment.stop",
    entityType: "affiliate_experiment",
    entityId: id,
  });
  return row!;
}

/**
 * Promotes a winner: it keeps its priority and weight, the other variants are paused. Without
 * `allowInconclusive` the winner must be the one the report calls (enough clicks, significant).
 */
export async function completeExperiment(
  db: DbOrTx,
  id: string,
  input: { winnerLinkId: string; allowInconclusive?: boolean; userId?: string | null; now?: Date },
) {
  const exp = await requireExperiment(db, id);
  if (exp.status === "completed") throw new DomainError("conflict", "This experiment is already completed");
  const report = await getExperimentReport(db, id, { now: input.now });
  const variantIds = report.variants.map((v) => v.linkId);
  if (!variantIds.includes(input.winnerLinkId)) throw new DomainError("invalid", "The winner must be a variant");
  if (!input.allowInconclusive && report.verdict.winnerLinkId !== input.winnerLinkId) {
    throw new DomainError("invalid", "The data does not support this winner yet; confirm to promote it anyway");
  }
  const losers = (
    await db
      .select({ id: affiliateLinks.id })
      .from(affiliateLinks)
      .where(and(eq(affiliateLinks.experimentId, id), inArray(affiliateLinks.id, variantIds)))
  )
    .map((l) => l.id)
    .filter((l) => l !== input.winnerLinkId);
  if (losers.length) {
    await db.update(affiliateLinks).set({ status: "paused" }).where(inArray(affiliateLinks.id, losers));
  }
  const [row] = await db
    .update(affiliateExperiments)
    .set({ status: "completed", endedAt: exp.endedAt ?? input.now ?? new Date(), winnerLinkId: input.winnerLinkId })
    .where(eq(affiliateExperiments.id, id))
    .returning();
  await recordAudit(db, {
    actorUserId: input.userId,
    action: "experiment.complete",
    entityType: "affiliate_experiment",
    entityId: id,
    data: { winnerLinkId: input.winnerLinkId, paused: losers, inconclusive: report.verdict.winnerLinkId === null },
  });
  return { experiment: row!, paused: losers };
}

export async function getExperiment(db: DbOrTx, id: string) {
  const [row] = await db.select().from(affiliateExperiments).where(eq(affiliateExperiments.id, id)).limit(1);
  return row ?? null;
}

export async function listExperiments(db: DbOrTx, opts: { productId?: string; status?: ExperimentStatus } = {}) {
  return db
    .select({
      experiment: affiliateExperiments,
      productName: products.name,
      variants: sql<number>`(select count(*)::int from ${affiliateLinks} where ${affiliateLinks.experimentId} = ${affiliateExperiments.id})`,
    })
    .from(affiliateExperiments)
    .innerJoin(products, eq(products.id, affiliateExperiments.productId))
    .where(
      and(
        opts.productId ? eq(affiliateExperiments.productId, opts.productId) : undefined,
        opts.status ? eq(affiliateExperiments.status, opts.status) : undefined,
      ),
    )
    .orderBy(desc(affiliateExperiments.startedAt));
}

// --- Statistics ------------------------------------------------------------------------------

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf; |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Two-sided p-value of a two-proportion z-test (pooled). Null when it cannot be computed. */
export function twoProportionPValue(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return x1 / n1 === x2 / n2 ? 1 : 0;
  return 2 * (1 - normalCdf(Math.abs(x1 / n1 - x2 / n2) / se));
}

/**
 * Two-sided p-value for a difference in mean earnings per click (Welch z-test). Each click earns
 * 0 or a conversion's commission, so the variance follows from the commission sum and sum of
 * squares. Null when it cannot be computed.
 */
export function epcPValue(
  a: { clicks: number; commission: number; commissionSq: number },
  b: { clicks: number; commission: number; commissionSq: number },
): number | null {
  if (a.clicks < 2 || b.clicks < 2) return null;
  const stats = (s: typeof a) => {
    const mean = s.commission / s.clicks;
    const variance = Math.max(0, (s.commissionSq - s.clicks * mean * mean) / (s.clicks - 1));
    return { mean, se2: variance / s.clicks };
  };
  const x = stats(a);
  const y = stats(b);
  const se = Math.sqrt(x.se2 + y.se2);
  if (se === 0) return x.mean === y.mean ? 1 : 0;
  return 2 * (1 - normalCdf(Math.abs(x.mean - y.mean) / se));
}

// --- Report ----------------------------------------------------------------------------------

export interface VariantReport {
  linkId: string;
  label: string;
  status: string;
  weight: number;
  programName: string | null;
  /** Human clicks tagged with this experiment. */
  clicks: number;
  /** Non-reversed conversions attributed to the variant through its SubID token. */
  conversions: number;
  /** Non-reversed commission (pending included, so tests can conclude before networks approve). */
  commission: number;
  /** Approved or paid commission only. */
  confirmedCommission: number;
  conversionRate: number | null;
  epc: number | null;
  trafficShare: number | null;
  /** p-values against the leader (null for the leader itself or when not computable). */
  pConversionRate: number | null;
  pEpc: number | null;
  enoughData: boolean;
}

export interface ExperimentReport {
  experiment: typeof affiliateExperiments.$inferSelect;
  policy: { minClicksPerVariant: number; confidence: number };
  variants: VariantReport[];
  totalClicks: number;
  verdict: {
    /** Variant the data supports (highest EPC, significantly ahead of every other); else null. */
    winnerLinkId: string | null;
    /** Highest EPC so far, significant or not. */
    leaderLinkId: string | null;
    state: "collecting" | "inconclusive" | "winner";
    message: string;
  };
}

/**
 * Per-variant clicks, conversions, conversion rate, commission and EPC with significance against
 * the leader (FR-AFF-13). The decision test is on EPC (what the experiment optimises); the
 * conversion-rate test is reported alongside. With more than two variants the significance level
 * is Bonferroni-corrected. No winner is called until every variant has the minimum clicks.
 */
export async function getExperimentReport(
  db: DbOrTx,
  experimentId: string,
  opts: { now?: Date } = {},
): Promise<ExperimentReport> {
  const experiment = await requireExperiment(db, experimentId);
  const policy = (await getSetting(db, "affiliate.experiments")) ?? DEFAULT_EXPERIMENT_POLICY;
  const now = opts.now ?? new Date();
  const until = experiment.endedAt
    ? new Date(experiment.endedAt.getTime() + EXPERIMENT_CONVERSION_GRACE_DAYS * 86_400_000)
    : now;
  // Variants: current members plus any link that received tagged clicks (membership can move on).
  const rows = await db.execute<{
    link_id: string;
    label: string | null;
    status: string | null;
    weight: number | null;
    program_name: string | null;
    clicks: number;
    conversions: number;
    commission: number;
    commission_sq: number;
    confirmed: number;
  }>(sql`
    with members as (
      select id as link_id from affiliate_links where experiment_id = ${experimentId}
      union
      select distinct link_id from clicks where experiment_id = ${experimentId} and link_id is not null
    ),
    k as (
      select link_id, count(*)::int as clicks from clicks
      where experiment_id = ${experimentId} and not is_bot
      group by link_id
    ),
    c as (
      select link_id,
        count(*)::int as conversions,
        coalesce(sum(commission), 0)::float8 as commission,
        coalesce(sum(commission * commission), 0)::float8 as commission_sq,
        coalesce(sum(commission) filter (where status in ('approved', 'paid')), 0)::float8 as confirmed
      from conversions
      where link_id in (select link_id from members) and status <> 'reversed'
        and occurred_at >= ${experiment.startedAt.toISOString()}::timestamptz
        and occurred_at < ${until.toISOString()}::timestamptz
      group by link_id
    )
    select m.link_id, l.label, l.status::text as status, l.weight, p.name as program_name,
      coalesce(k.clicks, 0)::int as clicks, coalesce(c.conversions, 0)::int as conversions,
      coalesce(c.commission, 0)::float8 as commission, coalesce(c.commission_sq, 0)::float8 as commission_sq,
      coalesce(c.confirmed, 0)::float8 as confirmed
    from members m
    left join affiliate_links l on l.id = m.link_id
    left join affiliate_programs p on p.id = l.program_id
    left join k on k.link_id = m.link_id
    left join c on c.link_id = m.link_id
    order by l.created_at nulls last
  `);
  const totalClicks = rows.reduce((s, r) => s + Number(r.clicks), 0);
  const base = rows.map((r) => {
    const clicks = Number(r.clicks);
    const commission = Number(r.commission);
    return {
      linkId: r.link_id,
      label: r.label ?? "(deleted link)",
      status: r.status ?? "deleted",
      weight: Number(r.weight ?? 0),
      programName: r.program_name,
      clicks,
      conversions: Number(r.conversions),
      commission,
      commissionSq: Number(r.commission_sq),
      confirmedCommission: Number(r.confirmed),
      conversionRate: clicks > 0 ? Number(r.conversions) / clicks : null,
      epc: clicks > 0 ? commission / clicks : null,
      trafficShare: totalClicks > 0 ? clicks / totalClicks : null,
      enoughData: clicks >= policy.minClicksPerVariant,
    };
  });
  const leader =
    [...base].filter((v) => v.clicks > 0).sort((a, b) => (b.epc ?? 0) - (a.epc ?? 0) || b.clicks - a.clicks)[0] ?? null;
  const variants: VariantReport[] = base.map((self) => {
    const { commissionSq: _sq, ...v } = self;
    if (!leader || self.linkId === leader.linkId) return { ...v, pConversionRate: null, pEpc: null };
    return {
      ...v,
      pConversionRate: twoProportionPValue(leader.conversions, leader.clicks, v.conversions, v.clicks),
      pEpc: epcPValue(leader, self),
    };
  });

  const alpha = (1 - policy.confidence) / Math.max(1, variants.length - 1);
  let verdict: ExperimentReport["verdict"];
  const short = variants.filter((v) => !v.enoughData);
  if (variants.length < 2) {
    verdict = {
      winnerLinkId: null,
      leaderLinkId: leader?.linkId ?? null,
      state: "collecting",
      message: "Fewer than two variants",
    };
  } else if (short.length) {
    const need = Math.max(...short.map((v) => policy.minClicksPerVariant - v.clicks));
    verdict = {
      winnerLinkId: null,
      leaderLinkId: leader?.linkId ?? null,
      state: "collecting",
      message: `Not enough data yet: every variant needs ${policy.minClicksPerVariant} clicks (${need} more to go)`,
    };
  } else {
    const others = variants.filter((v) => v.linkId !== leader!.linkId);
    const significant = others.every((v) => v.pEpc !== null && v.pEpc < alpha && (v.epc ?? 0) < (leader!.epc ?? 0));
    verdict = significant
      ? {
          winnerLinkId: leader!.linkId,
          leaderLinkId: leader!.linkId,
          state: "winner",
          message: `“${leader!.label}” earns more per click at ${Math.round(policy.confidence * 100)}% confidence`,
        }
      : {
          winnerLinkId: null,
          leaderLinkId: leader?.linkId ?? null,
          state: "inconclusive",
          message: `No variant is ahead at ${Math.round(policy.confidence * 100)}% confidence yet; keep the test running or stop it`,
        };
  }
  return { experiment, policy, variants, totalClicks, verdict };
}
