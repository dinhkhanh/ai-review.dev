import {
  assertPublicHttpUrl,
  costSink,
  DomainError,
  findProductByDomain,
  getSetting,
  knownDomains,
  notify,
  upsertSuggestion,
  type SettingValue,
} from "@repo/core";
import { createRobotsChecker, BOT_USER_AGENT } from "../research/robots";
import { mapLimit, type StepServices } from "../step";
import { probeAffiliate, UNPROBED, type AffiliateSignal } from "./affiliate-probe";
import { classifyCandidates, type Classification } from "./classify";
import {
  collectHackerNews,
  collectProductHuntApi,
  collectProductHuntFeed,
  fetchProductHuntPost,
  stripTags,
  toWebsite,
  type CollectorResult,
  type SourcingCandidate,
} from "./collectors";
import { expectedValue } from "./score";

export type SourcingPolicy = SettingValue<"sourcing.policy">;
export type SourcingServices = Pick<StepServices, "db" | "makeLlm" | "fetch">;

export const DEFAULT_SOURCING_POLICY: SourcingPolicy = {
  enabled: false,
  sources: ["producthunt", "hackernews", "networks"],
  maxPerRun: 25,
  minScore: 1,
};

/**
 * Candidates classified per run; the rest (lowest traction) wait for a later run. Off-topic launches
 * are not stored, so they are re-screened while they stay in the feeds (a cent a day on Haiku).
 */
const MAX_CLASSIFY = 80;
/** Minimum classifier confidence for a candidate to be considered on-topic. */
const MIN_FIT = 0.4;

export interface SourcingOptions {
  now?: Date;
  /** Overrides the "sourcing.policy" setting. */
  policy?: SourcingPolicy;
  /** Run even when the policy is disabled ("Run sourcing now"). */
  force?: boolean;
  productHuntToken?: string | null;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface SourcingSummary {
  skipped: boolean;
  collected: number;
  newCandidates: number;
  classified: number;
  onTopic: number;
  probed: number;
  created: number;
  updated: number;
  errors: string[];
}

/** Evidence stored on `product_suggestions.signals` and rendered in the CMS queue. */
export function buildSignals(
  c: SourcingCandidate,
  cls: Classification | null,
  affiliate: AffiliateSignal,
  components: ReturnType<typeof expectedValue>["components"],
) {
  return {
    description: c.description,
    launch: c.launch,
    category: cls,
    affiliate,
    components,
    formula: "fit × freshness × (0.5 + affiliate) × (0.5 + demand)",
  };
}

const traction = (c: SourcingCandidate) => Math.max(c.launch.votes ?? 0, c.launch.points ?? 0);

/** Same domain from several sources: keep the entry with the most traction. */
export function dedupeCandidates(candidates: SourcingCandidate[]): SourcingCandidate[] {
  const byDomain = new Map<string, SourcingCandidate>();
  for (const c of candidates) {
    const prev = byDomain.get(c.domain);
    if (!prev || traction(c) > traction(prev)) byDomain.set(c.domain, c);
  }
  return [...byDomain.values()];
}

/**
 * Product sourcing run (FR-INT-7): collect new launches → drop known domains → classify category
 * fit → probe affiliate programs → score by expected value → queue the best `maxPerRun` with
 * score ≥ `minScore` as "Suggested products". Notifies when new suggestions were added.
 */
export async function runProductSourcing(
  services: SourcingServices,
  opts: SourcingOptions = {},
): Promise<SourcingSummary> {
  const { db } = services;
  const now = opts.now ?? new Date();
  const fetchImpl = services.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const policy = opts.policy ?? (await getSetting(db, "sourcing.policy")) ?? DEFAULT_SOURCING_POLICY;
  const summary: SourcingSummary = {
    skipped: false,
    collected: 0,
    newCandidates: 0,
    classified: 0,
    onTopic: 0,
    probed: 0,
    created: 0,
    updated: 0,
    errors: [],
  };
  if (!policy.enabled && !opts.force) return { ...summary, skipped: true };

  const token = opts.productHuntToken === undefined ? (process.env.PRODUCT_HUNT_TOKEN ?? null) : opts.productHuntToken;
  const collectors: Array<Promise<CollectorResult>> = [];
  if (policy.sources.includes("producthunt")) {
    collectors.push(
      token ? collectProductHuntApi(token, { fetch: fetchImpl }) : collectProductHuntFeed({ fetch: fetchImpl }),
    );
  }
  if (policy.sources.includes("hackernews")) collectors.push(collectHackerNews({ fetch: fetchImpl, now }));
  const results = await Promise.all(collectors);
  const all = results.flatMap((r) => r.candidates);
  summary.errors.push(...results.flatMap((r) => r.errors));
  summary.collected = all.length;

  const deduped = dedupeCandidates(all);
  const known = await knownDomains(
    db,
    deduped.map((c) => c.domain),
  );
  const fresh = deduped
    .filter((c) => !known.has(c.domain))
    .sort((a, b) => traction(b) - traction(a))
    .slice(0, MAX_CLASSIFY);
  summary.newCandidates = fresh.length;
  log("sourcing candidates", { collected: all.length, unique: deduped.length, fresh: fresh.length });
  if (fresh.length === 0) return summary;

  const llm = services.makeLlm(costSink(db, {}));
  let classes: Map<string, Classification>;
  try {
    classes = await classifyCandidates(db, llm, fresh);
  } catch (error) {
    summary.errors.push(`classify: ${String(error).slice(0, 200)}`);
    return summary;
  }
  summary.classified = classes.size;
  const onTopic = fresh.filter((c) => {
    const cls = classes.get(c.domain);
    return !!cls?.categorySlug && cls.confidence >= MIN_FIT;
  });
  summary.onTopic = onTopic.length;

  const robots = createRobotsChecker(fetchImpl);
  const probe = policy.sources.includes("networks");
  const scored = await mapLimit(onTopic, 4, async (c) => {
    const affiliate = probe
      ? await probeAffiliate(c.url, { fetch: fetchImpl, robots }).catch(() => UNPROBED)
      : UNPROBED;
    const cls = classes.get(c.domain)!;
    const { score, components } = expectedValue(c, affiliate, cls.confidence, now);
    return { c, cls, affiliate, score, components };
  });
  summary.probed = probe ? scored.filter((s) => s.affiliate.probed).length : 0;

  const best = scored
    .filter((s) => s.score >= policy.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, policy.maxPerRun);
  for (const s of best) {
    try {
      const res = await upsertSuggestion(db, {
        name: s.c.name,
        url: s.c.url,
        categorySlug: s.cls.categorySlug,
        source: s.c.source,
        score: s.score,
        signals: buildSignals(s.c, s.cls, s.affiliate, s.components),
      });
      if (res.created) summary.created++;
      else summary.updated++;
    } catch (error) {
      summary.errors.push(`${s.c.domain}: ${String(error).slice(0, 120)}`);
    }
  }
  if (summary.created > 0) {
    await notify(db, {
      event: "sourcing.suggestions",
      title: `${summary.created} new suggested product${summary.created === 1 ? "" : "s"}`,
      body: best
        .slice(0, 5)
        .map((s) => `${s.c.name} (${s.c.domain}) — score ${s.score}`)
        .join("\n"),
      href: "/suggestions",
      dedupeKey: `sourcing:${now.toISOString().slice(0, 13)}`,
    });
  }
  log("sourcing done", { ...summary });
  return summary;
}

function metaContent(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
  const reversed = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, "i");
  return re.exec(html)?.[1] ?? reversed.exec(html)?.[1] ?? null;
}

/** Name and description from a homepage (og:site_name, <title>, meta description). */
export function describeHomepage(html: string, fallbackName: string): { name: string; description: string | null } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const siteName = metaContent(html, "og:site_name");
  const name = stripTags(siteName ?? title?.split(/\s[|–—-]\s|:\s/)[0] ?? "") || fallbackName;
  const description = metaContent(html, "description") ?? metaContent(html, "og:description");
  return { name: name.slice(0, 80), description: description ? stripTags(description).slice(0, 300) : null };
}

/**
 * Manual sourcing (FR-INT-7 lightweight version): the admin pastes a product website or a Product
 * Hunt post URL; the candidate is classified, probed and scored like a cron find, then queued
 * regardless of the score threshold.
 */
export async function evaluateCandidateUrl(
  services: SourcingServices,
  rawUrl: string,
  opts: { now?: Date; productHuntToken?: string | null } = {},
) {
  const { db } = services;
  const fetchImpl = services.fetch ?? fetch;
  const now = opts.now ?? new Date();
  const input = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  assertPublicHttpUrl(input);

  let candidate: SourcingCandidate | null;
  const ph = /producthunt\.com\/(?:products|posts)\/([a-z0-9-]+)/i.exec(input);
  if (ph) {
    const token =
      opts.productHuntToken === undefined ? (process.env.PRODUCT_HUNT_TOKEN ?? null) : opts.productHuntToken;
    if (!token) {
      throw new DomainError(
        "invalid",
        "Product Hunt pages need PRODUCT_HUNT_TOKEN; paste the product's website instead",
      );
    }
    candidate = await fetchProductHuntPost(ph[1]!.toLowerCase(), token, fetchImpl);
    if (!candidate) throw new DomainError("not_found", "Product Hunt post not found or it has no website");
    candidate = { ...candidate, source: "manual" };
  } else {
    const site = toWebsite(input);
    if (!site) throw new DomainError("invalid", "That URL is not a product's own website");
    let page = { name: site.domain, description: null as string | null };
    try {
      const res = await fetchImpl(`${site.url}/`, {
        headers: { "User-Agent": BOT_USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) page = describeHomepage((await res.text()).slice(0, 300_000), site.domain);
    } catch {
      // Keep the domain as the name; the review job resolves the real name later.
    }
    candidate = {
      ...page,
      ...site,
      source: "manual",
      launch: {
        url: input,
        title: page.name,
        votes: null,
        points: null,
        comments: null,
        publishedAt: null,
        topics: [],
      },
    };
  }

  const existing = await findProductByDomain(db, candidate.domain);
  if (existing) throw new DomainError("conflict", `${existing.name} is already a product`, { productId: existing.id });

  const llm = services.makeLlm(costSink(db, {}));
  const cls = (await classifyCandidates(db, llm, [candidate])).get(candidate.domain) ?? null;
  const affiliate = await probeAffiliate(candidate.url, { fetch: fetchImpl }).catch(() => UNPROBED);
  const { score, components } = expectedValue(candidate, affiliate, cls?.confidence ?? 0, now);
  return upsertSuggestion(db, {
    name: candidate.name,
    url: candidate.url,
    categorySlug: cls?.categorySlug ?? null,
    source: "manual",
    score,
    signals: buildSignals(candidate, cls, affiliate, components),
  });
}
