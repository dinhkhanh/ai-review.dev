import type { LinkFormat, Network } from "./index";

/**
 * SubID parameter each network documents for click-level attribution (FR-AFF-4, SRS §1.3).
 * Used when a program's link format does not name one explicitly.
 */
export const NETWORK_SUBID_PARAMS: Partial<Record<Network, string>> = {
  impact: "subId1",
  partnerstack: "ps_xid",
  awin: "clickref",
  shareasale: "afftrack",
  cj: "sid",
  rewardful: "sub_id",
  firstpromoter: "fp_sid",
  tolt: "sub_id",
  lemonsqueezy: "aff_sub",
  skimlinks: "xcust",
  sovrn: "cuid",
};

/** Placement codes passed to the go-link as `?p=` (FR-WEB-5). */
export const PLACEMENTS = {
  hero: "hero",
  verdict: "verdict",
  pricing: "pricing",
  comparison: "comparison",
  inline: "inline",
  sticky: "sticky_mobile",
  final: "final_cta",
  card: "card",
} as const;
export type Placement = (typeof PLACEMENTS)[keyof typeof PLACEMENTS];

const SAFE_TOKEN = /[^a-z0-9_-]+/g;

/** Lowercase, URL-safe token: letters, digits, `-` and `_` only, at most `max` chars. */
export function sanitizeToken(input: string | null | undefined, max = 40): string {
  return (input ?? "")
    .toLowerCase()
    .replace(SAFE_TOKEN, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

/**
 * SubID appended to tracked links: `<article-slug>--<placement>` so network reports can be joined
 * back to a page and placement (FR-AFF-6, FR-AFF-12). Always ≤ 64 URL-safe characters.
 */
export function buildSubId(articleSlug: string | null | undefined, placement: string | null | undefined): string {
  const page = sanitizeToken(articleSlug, 40) || "go";
  const where = sanitizeToken(placement, 20) || "direct";
  return `${page}--${where}`;
}

/** Splits a SubID back into its parts (inverse of `buildSubId`). */
export function parseSubId(subId: string): { articleSlug: string | null; placement: string | null } {
  const [page, where] = subId.split("--");
  return {
    articleSlug: page && page !== "go" ? page : null,
    placement: where && where !== "direct" ? where : null,
  };
}

function parseHttpUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Affiliate links must be http(s): ${input}`);
  }
  return url;
}

function subIdParamFor(format: LinkFormat | null, network: Network | null): string | undefined {
  if (format?.subIdParam) return format.subIdParam;
  if (format?.kind === "network_link") return NETWORK_SUBID_PARAMS[format.network];
  return network ? NETWORK_SUBID_PARAMS[network] : undefined;
}

export interface BuildOptions {
  subId?: string | null;
  /** The program's network, used to pick a default SubID parameter. */
  network?: Network | null;
}

/**
 * Builds the outbound tracked URL from a stored destination and the program's link format
 * (FR-AFF-4). Pure: never double-encodes (values go through URLSearchParams exactly once) and
 * replaces an existing parameter rather than appending a duplicate.
 */
export function buildTrackedUrl(destination: string, format: LinkFormat | null, opts: BuildOptions = {}): string {
  const url = parseHttpUrl(destination);
  // No stored format: a pasted link. The network's documented SubID param still applies.
  if (format?.kind === "query_param") url.searchParams.set(format.param, format.value);
  const subIdParam = subIdParamFor(format, opts.network ?? null);
  if (subIdParam && opts.subId) url.searchParams.set(subIdParam, opts.subId);
  return url.toString();
}

export interface UtmOptions {
  campaign: string;
  content?: string | null;
  source?: string;
  medium?: string;
}

/**
 * Vendor-URL fallback with UTM parameters (FR-AFF-5) so the CTA works before any program exists.
 * Existing UTM values on the URL are kept.
 */
export function withUtm(destination: string, opts: UtmOptions): string {
  const url = parseHttpUrl(destination);
  const set = (key: string, value: string | null | undefined) => {
    if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  };
  set("utm_source", opts.source ?? "ai-review.dev");
  set("utm_medium", opts.medium ?? "referral");
  set("utm_campaign", sanitizeToken(opts.campaign, 60));
  set("utm_content", opts.content ? sanitizeToken(opts.content, 40) : null);
  return url.toString();
}

/** Catch-all network used to monetise the vendor fallback (FR-AFF-5, D-4). */
export interface CatchAllConfig {
  network: "skimlinks" | "sovrn";
  /** Skimlinks publisher id or Sovrn (VigLink) API key; both are public by design. */
  publisherId: string;
}

/**
 * Wraps an outbound URL in the catch-all network's redirect so merchants that run a program there
 * still pay a commission. The SubID travels in the network's custom-tracking parameter.
 */
export function wrapCatchAll(destination: string, config: CatchAllConfig, subId: string): string {
  const target = parseHttpUrl(destination).toString();
  if (config.network === "skimlinks") {
    const url = new URL("https://go.skimresources.com/");
    url.searchParams.set("id", config.publisherId);
    url.searchParams.set("xs", "1");
    url.searchParams.set("url", target);
    url.searchParams.set("xcust", subId);
    return url.toString();
  }
  const url = new URL("https://redirect.viglink.com/");
  url.searchParams.set("key", config.publisherId);
  url.searchParams.set("u", target);
  url.searchParams.set("cuid", subId);
  return url.toString();
}
