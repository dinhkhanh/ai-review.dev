import { getDomain } from "tldts";

/** Official pages worth reading, in priority order (FR-RES-1). */
const PAGE_RULES: Array<{ key: string; pattern: RegExp; max: number }> = [
  { key: "pricing", pattern: /\/(pricing|plans?|price|buy|subscribe)(\/|$|\?)/i, max: 2 },
  { key: "features", pattern: /\/(features?|product|platform|capabilities|how-it-works|tour)(\/|$)/i, max: 3 },
  { key: "integrations", pattern: /\/(integrations?|apps|marketplace|connectors|plugins)(\/|$)/i, max: 1 },
  { key: "security", pattern: /\/(security|trust|compliance|gdpr|soc-?2|privacy-and-security)(\/|$)/i, max: 2 },
  { key: "faq", pattern: /\/(faq|faqs|help\/?$|support\/?$)(\/|$)/i, max: 1 },
  { key: "enterprise", pattern: /\/(enterprise|teams?|business)(\/|$)/i, max: 1 },
  { key: "changelog", pattern: /\/(changelog|release-notes|releases|whats-new|updates)(\/|$)/i, max: 1 },
  { key: "docs", pattern: /\/(docs|documentation|developers?|api)(\/?$)/i, max: 1 },
  { key: "about", pattern: /\/(about|company|about-us)(\/|$)/i, max: 1 },
  { key: "customers", pattern: /\/(customers|case-studies|testimonials)(\/?$)/i, max: 1 },
  { key: "compare", pattern: /\/(compare|vs|alternatives?)(\/|$)/i, max: 1 },
];

/** Locale prefixes, legal boilerplate, assets and deep blog posts are not product evidence. */
const SKIP = [
  /\/(?:[a-z]{2}(?:-[a-z]{2})?)\/(?!$)/i, // /fr/..., /pt-br/... (keep English roots)
  /\/(blog|news|press|careers|jobs|events|webinars?|podcast|legal|cookie|login|signin|signup|register|auth)\b/i,
  /\.(png|jpe?g|gif|svg|webp|pdf|zip|xml|json|css|js)(\?|$)/i,
  /[?#]/,
];
const LOCALE_ALLOW = /^\/(en|en-us|en-gb)\//i;

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

export function sameSite(url: string, websiteUrl: string): boolean {
  try {
    return getDomain(new URL(url).hostname) === getDomain(new URL(websiteUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Picks up to `limit` official URLs: the homepage, the resolved pricing page, then the best
 * match per page type (shortest path wins), never more than `max` per type.
 */
export function selectOfficialUrls(
  links: string[],
  opts: { websiteUrl: string; pricingUrl?: string | null; limit?: number },
): Array<{ url: string; key: string }> {
  const limit = opts.limit ?? 15;
  const picked = new Map<string, string>();
  const add = (url: string, key: string) => {
    const norm = url.replace(/#.*$/, "").replace(/\/+$/, "");
    if (!picked.has(norm) && picked.size < limit) picked.set(norm, key);
  };
  add(opts.websiteUrl, "home");
  if (opts.pricingUrl && sameSite(opts.pricingUrl, opts.websiteUrl)) add(opts.pricingUrl, "pricing");

  const candidates = [...new Set(links)]
    .filter((u) => /^https?:\/\//.test(u) && sameSite(u, opts.websiteUrl))
    .filter((u) => {
      const path = pathOf(u);
      if (!path) return false;
      if (LOCALE_ALLOW.test(path)) return true;
      return !SKIP.some((re) => re.test(u.replace(/^https?:\/\/[^/]+/, "")));
    })
    .sort((a, b) => pathOf(a)!.length - pathOf(b)!.length || a.localeCompare(b));

  for (const rule of PAGE_RULES) {
    const already = [...picked.values()].filter((k) => k === rule.key).length;
    const matches = candidates
      .filter((u) => rule.pattern.test(`${pathOf(u)}/`))
      .slice(0, Math.max(0, rule.max - already));
    for (const m of matches) add(m, rule.key);
  }
  return [...picked.entries()].map(([url, key]) => ({ url, key }));
}

export type ThirdPartyKind = "aggregator" | "community" | "video" | "news";

const AGGREGATORS = [
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "producthunt.com",
  "getapp.com",
  "softwareadvice.com",
  "trustradius.com",
  "saasworthy.com",
  "sourceforge.net",
  "alternativeto.net",
];
const COMMUNITY = [
  "reddit.com",
  "news.ycombinator.com",
  "indiehackers.com",
  "stackoverflow.com",
  "dev.to",
  "lobste.rs",
];
const VIDEO = ["youtube.com", "youtu.be", "vimeo.com"];

export const AGGREGATOR_DOMAINS = AGGREGATORS;
export const COMMUNITY_DOMAINS = COMMUNITY;

export function classifyThirdParty(url: string): ThirdPartyKind {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "news";
  }
  const matches = (list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));
  if (matches(AGGREGATORS)) return "aggregator";
  if (matches(COMMUNITY)) return "community";
  if (matches(VIDEO)) return "video";
  return "news";
}
