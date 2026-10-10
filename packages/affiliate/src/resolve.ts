import type { LinkFormat, LinkStatus, Network, ProgramStatus, RedirectPolicy } from "./index";
import { buildSubId, buildTrackedUrl, withUtm, wrapCatchAll, type CatchAllConfig } from "./links";

/** One affiliate link with the program fields the resolver needs. */
export interface LinkCandidate {
  id: string;
  destinationUrl: string;
  /** ISO 3166-1 alpha-2 (uppercase) or "global". */
  region: string;
  status: LinkStatus;
  /** Lower numbers are tried first. */
  priority: number;
  /** Relative traffic share among links with the same priority (A/B, FR-AFF-13). */
  weight: number;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Running A/B test this link is a variant of (FR-AFF-13); null when not in a running test. */
  experimentId?: string | null;
  program: {
    id: string;
    status: ProgramStatus;
    network: Network;
    redirectPolicy: RedirectPolicy;
    linkFormat: LinkFormat | null;
  } | null;
}

/** Everything needed to resolve a go-slug; cached per slug (NFR-2). */
export interface GoLinkTable {
  slug: string;
  productId: string;
  /** Vendor URL used when no affiliate link is usable (FR-AFF-5). */
  fallbackUrl: string;
  links: LinkCandidate[];
  /** Catch-all network wrapping the fallback when enabled in settings (FR-AFF-5). */
  catchAll?: CatchAllConfig | null;
}

export interface ResolveContext {
  /** Visitor country (ISO alpha-2), if known. */
  country?: string | null;
  articleSlug?: string | null;
  placement?: string | null;
  now?: Date;
  /** Injected for deterministic tests; defaults to Math.random. */
  random?: () => number;
}

export interface Resolution {
  url: string;
  linkId: string | null;
  programId: string | null;
  fallback: boolean;
  subId: string;
  /** Running A/B test the chosen link belongs to (FR-AFF-13). */
  experimentId: string | null;
}

/** A link is usable when it and its program are active and today is inside its date window. */
export function isLinkEligible(link: LinkCandidate, now: Date): boolean {
  if (link.status !== "active") return false;
  if (link.program && link.program.status !== "active") return false;
  if (link.startsAt && link.startsAt > now) return false;
  if (link.endsAt && link.endsAt <= now) return false;
  return true;
}

function pickWeighted(links: LinkCandidate[], random: () => number): LinkCandidate {
  const total = links.reduce((sum, l) => sum + Math.max(0, l.weight), 0);
  if (total <= 0) return links[0]!;
  let roll = random() * total;
  for (const link of links) {
    roll -= Math.max(0, link.weight);
    if (roll < 0) return link;
  }
  return links[links.length - 1]!;
}

/**
 * Chooses the link for a visitor: eligible links for their country first, otherwise global ones;
 * then the lowest priority number; ties split by weight. Programs whose terms forbid redirects
 * are skipped here: the renderer links to them directly (constraint C-2, FR-AFF-9).
 */
export function selectLink(links: LinkCandidate[], ctx: ResolveContext = {}): LinkCandidate | null {
  const now = ctx.now ?? new Date();
  const country = ctx.country?.toUpperCase() ?? null;
  const eligible = links.filter((l) => isLinkEligible(l, now) && l.program?.redirectPolicy !== "forbidden");
  const local = country ? eligible.filter((l) => l.region.toUpperCase() === country) : [];
  const pool = local.length > 0 ? local : eligible.filter((l) => l.region.toLowerCase() === "global");
  if (pool.length === 0) return null;
  const best = Math.min(...pool.map((l) => l.priority));
  return pickWeighted(
    pool.filter((l) => l.priority === best),
    ctx.random ?? Math.random,
  );
}

/**
 * Resolves `/go/:slug` to an outbound URL (FR-AFF-6). Never throws for a bad link: a link whose
 * URL cannot be built is skipped and the vendor fallback is used, so visitors never see an error.
 */
export function resolveGoLink(table: GoLinkTable, ctx: ResolveContext = {}): Resolution {
  let remaining = table.links;
  while (remaining.length > 0) {
    const link = selectLink(remaining, ctx);
    if (!link) break;
    const experimentId = link.experimentId ?? null;
    // Variant clicks carry the link in the SubID so conversions attribute to it (FR-AFF-13).
    const subId = buildSubId(ctx.articleSlug, ctx.placement, experimentId ? link.id : null);
    try {
      const url = buildTrackedUrl(link.destinationUrl, link.program?.linkFormat ?? null, {
        subId,
        network: link.program?.network ?? null,
      });
      return { url, linkId: link.id, programId: link.program?.id ?? null, fallback: false, subId, experimentId };
    } catch {
      remaining = remaining.filter((l) => l.id !== link.id);
    }
  }
  const subId = buildSubId(ctx.articleSlug, ctx.placement);
  const vendorUrl = withUtm(table.fallbackUrl, { campaign: table.slug, content: ctx.placement ?? null });
  return {
    url: table.catchAll ? wrapCatchAll(vendorUrl, table.catchAll, subId) : vendorUrl,
    linkId: null,
    programId: null,
    fallback: true,
    subId,
    experimentId: null,
  };
}

/**
 * How the renderer should link a CTA (constraint C-2): through `/go/:slug`, or directly to the
 * tracked URL when the best link's program forbids redirects (e.g. Amazon Associates).
 */
export function ctaTarget(
  table: GoLinkTable,
  ctx: ResolveContext = {},
): { kind: "golink" } | { kind: "direct"; url: string } {
  const now = ctx.now ?? new Date();
  const forbidden = table.links
    .flatMap((link) =>
      link.program?.redirectPolicy === "forbidden" && isLinkEligible(link, now)
        ? [{ link, program: link.program }]
        : [],
    )
    .sort((a, b) => a.link.priority - b.link.priority);
  const redirectable = selectLink(table.links, ctx);
  const top = forbidden[0];
  if (top && (!redirectable || top.link.priority < redirectable.priority)) {
    try {
      const url = buildTrackedUrl(top.link.destinationUrl, top.program.linkFormat, {
        subId: buildSubId(ctx.articleSlug, ctx.placement),
        network: top.program.network,
      });
      return { kind: "direct", url };
    } catch {
      return { kind: "golink" };
    }
  }
  return { kind: "golink" };
}
