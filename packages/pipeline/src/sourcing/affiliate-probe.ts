import { assertPublicHttpUrl } from "@repo/core";
import { BOT_USER_AGENT, createRobotsChecker } from "../research/robots";
import { stripTags } from "./collectors";

/** Affiliate availability for a candidate (FR-INT-7 signal "affiliate availability and commission"). */
export interface AffiliateSignal {
  /** We looked (false when probing was disabled or the site was unreachable). */
  probed: boolean;
  /** A partner/affiliate/referral program is advertised. */
  found: boolean;
  /** Page that advertises it. */
  url: string | null;
  recurring: boolean;
  commissionPercent: number | null;
  cookieDays: number | null;
  /** Affiliate network or platform hinted by links or tracking scripts. */
  network: string | null;
  /** Short quote around the terms, for the CMS evidence column. */
  evidence: string | null;
}

export const UNPROBED: AffiliateSignal = {
  probed: false,
  found: false,
  url: null,
  recurring: false,
  commissionPercent: null,
  cookieDays: null,
  network: null,
  evidence: null,
};

/** Network/platform fingerprints in links, scripts or text → KNOWN_NETWORKS name. */
const NETWORK_HINTS: Array<[RegExp, string]> = [
  [/partnerstack|growsumo/i, "partnerstack"],
  [/rewardful|r\.wdfl\.co/i, "rewardful"],
  [/firstpromoter/i, "firstpromoter"],
  [/tolt\.(io|com)|cdn\.tolt/i, "tolt"],
  [/impact\.com|impactradius|sjv\.io/i, "impact"],
  [/awin\.com|awin1\.com/i, "awin"],
  [/shareasale/i, "shareasale"],
  [/lemonsqueezy/i, "lemonsqueezy"],
  [/paddle\.com\/affiliates|paddle affiliate/i, "paddle"],
  [/\bcj\.com|commission junction/i, "cj"],
];

const PROGRAM_LINK = /affiliat|partner[-_ ]?program|\/partners?\b|referr|refer-a-friend|ambassador/i;
const PROGRAM_TEXT = /affiliate|commission|referral program|partner program|earn \d|revenue share/i;
const FALLBACK_PATHS = ["/affiliates", "/affiliate", "/partners", "/referral"];

export function detectNetwork(text: string): string | null {
  return NETWORK_HINTS.find(([re]) => re.test(text))?.[1] ?? null;
}

/**
 * Pulls commission terms out of a program page's text: the highest commission-like percentage,
 * whether it recurs, and the cookie window. Conservative: only percentages near commission words.
 */
export function parseAffiliateTerms(text: string): {
  commissionPercent: number | null;
  recurring: boolean;
  cookieDays: number | null;
  evidence: string | null;
} {
  let best: { pct: number; recurring: boolean; quote: string } | null = null;
  for (const m of text.matchAll(/(\d{1,2}(?:\.\d+)?)\s?%/g)) {
    const pct = Number(m[1]);
    const start = Math.max(0, m.index! - 80);
    const window = text.slice(start, m.index! + m[0].length + 80);
    if (pct <= 0 || pct > 70) continue;
    if (!/commission|recurring|earn|revenue share|payout|lifetime|referr|affiliate/i.test(window)) continue;
    const recurring =
      /recurring|lifetime|every month|each month|monthly|for (?:\d+|twelve|the first \d+) months|every payment|as long as/i.test(
        window,
      );
    if (!best || pct > best.pct || (pct === best.pct && recurring && !best.recurring)) {
      best = { pct, recurring, quote: window.trim() };
    }
  }
  const cookie =
    /(\d{1,3})[\s-]?days?\s+(?:cookie|attribution|tracking|referral)/i.exec(text) ??
    /cookie[^.\n]{0,40}?(\d{1,3})\s?days?/i.exec(text);
  const cookieDays = cookie ? Number(cookie[1]) : null;
  return {
    commissionPercent: best?.pct ?? null,
    recurring: best?.recurring ?? /recurring commission|lifetime commission/i.test(text),
    cookieDays: cookieDays && cookieDays > 0 && cookieDays <= 365 ? cookieDays : null,
    evidence: best?.quote.slice(0, 220) ?? null,
  };
}

/** Same-site or network program links found in a homepage's HTML. */
export function programLinks(html: string, origin: string): string[] {
  const out = new Set<string>();
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"#]+)"/gi)) {
    let url: URL;
    try {
      url = new URL(href!, origin);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    const sameSite =
      url.hostname === new URL(origin).hostname ||
      url.hostname.endsWith(`.${new URL(origin).hostname.replace(/^www\./, "")}`);
    if ((sameSite && PROGRAM_LINK.test(url.pathname)) || (!sameSite && detectNetwork(url.hostname))) {
      out.add(url.toString());
    }
  }
  return [...out];
}

async function fetchHtml(url: string, fetchImpl: typeof fetch): Promise<{ url: string; html: string } | null> {
  try {
    assertPublicHttpUrl(url);
    const res = await fetchImpl(url, {
      headers: { "User-Agent": BOT_USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(8_000),
      redirect: "follow",
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "text/html").includes("html")) return null;
    const finalUrl = res.url || url;
    assertPublicHttpUrl(finalUrl);
    return { url: finalUrl, html: (await res.text()).slice(0, 600_000) };
  } catch {
    return null;
  }
}

/**
 * Cheap affiliate probe (≤ 3 requests + robots.txt): the homepage for program links and network
 * scripts, then up to two program pages (linked ones first, else common paths) for the terms.
 * Respects robots.txt and refuses non-public hosts (NFR-7).
 */
export async function probeAffiliate(
  website: string,
  opts: { fetch?: typeof fetch; robots?: ReturnType<typeof createRobotsChecker> } = {},
): Promise<AffiliateSignal> {
  const fetchImpl = opts.fetch ?? fetch;
  const robots = opts.robots ?? createRobotsChecker(fetchImpl);
  const origin = new URL(website).origin;
  if (!(await robots.isAllowed(`${origin}/`))) return UNPROBED;
  const home = await fetchHtml(`${origin}/`, fetchImpl);
  if (!home) return UNPROBED;

  const links = programLinks(home.html, home.url);
  let network = detectNetwork(home.html.match(/<script[^>]*src="[^"]+"/gi)?.join(" ") ?? "") ?? null;
  const external = links.find((l) => new URL(l).hostname !== new URL(home.url).hostname);
  if (external) network ??= detectNetwork(external);

  const sameSiteLinks = links.filter((l) => l !== external);
  const pages = sameSiteLinks.length
    ? sameSiteLinks.slice(0, 2)
    : FALLBACK_PATHS.slice(0, 2).map((p) => `${origin}${p}`);
  for (const pageUrl of pages) {
    if (!(await robots.isAllowed(pageUrl))) continue;
    const page = await fetchHtml(pageUrl, fetchImpl);
    if (!page) continue;
    const text = stripTags(page.html);
    if (!PROGRAM_TEXT.test(text)) continue;
    const terms = parseAffiliateTerms(text);
    return {
      probed: true,
      found: true,
      url: page.url,
      ...terms,
      network: network ?? detectNetwork(page.html),
    };
  }
  return {
    ...UNPROBED,
    probed: true,
    // A link to a network signup page or a network tracking script is enough to know a program exists.
    found: !!(external || network),
    url: external ?? null,
    network,
  };
}
