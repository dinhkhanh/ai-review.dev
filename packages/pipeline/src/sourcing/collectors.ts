import { normalizeWebsiteUrl, registrableDomain } from "@repo/core";
import { BOT_USER_AGENT } from "../research/robots";

/** A product found by a sourcing collector, before classification and scoring (FR-INT-7). */
export interface SourcingCandidate {
  name: string;
  /** Normalised official website origin. */
  url: string;
  /** Registrable domain, the dedupe key shared with products and suggestions. */
  domain: string;
  description: string | null;
  source: "producthunt" | "hackernews" | "manual";
  launch: {
    /** Launch post (Product Hunt page, HN thread) shown as evidence in the CMS. */
    url: string | null;
    title: string;
    /** Product Hunt upvotes. */
    votes: number | null;
    /** Hacker News points. */
    points: number | null;
    comments: number | null;
    publishedAt: string | null;
    topics: string[];
  };
}

export interface CollectorResult {
  candidates: SourcingCandidate[];
  /** Entries found but dropped (no resolvable website, excluded host...). */
  skipped: number;
  errors: string[];
}

/**
 * Hosts that are never a product's own site: code hosts, app stores, social and publishing
 * platforms, and shared hosting suffixes where the registrable domain belongs to the platform.
 */
const EXCLUDED_DOMAINS = new Set([
  "github.com",
  "github.io",
  "gitlab.com",
  "bitbucket.org",
  "sourceforge.net",
  "producthunt.com",
  "ycombinator.com",
  "apple.com",
  "google.com",
  "microsoft.com",
  "mozilla.org",
  "youtube.com",
  "youtu.be",
  "medium.com",
  "substack.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "discord.gg",
  "discord.com",
  "notion.site",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "herokuapp.com",
  "fly.dev",
  "web.app",
  "firebaseapp.com",
  "replit.app",
  "itch.io",
  "blogspot.com",
  "wordpress.com",
  "wixsite.com",
  "carrd.co",
  "webflow.io",
  "framer.website",
  "gitbook.io",
  "readthedocs.io",
  "streamlit.app",
  "huggingface.co",
  "arxiv.org",
  "wikipedia.org",
  "npmjs.com",
  "pypi.org",
  "crates.io",
  "docs.google.com",
]);

/** Normalises a candidate's website; null when it is not a usable, product-owned public URL. */
export function toWebsite(raw: string | null | undefined): { url: string; domain: string } | null {
  if (!raw) return null;
  try {
    const url = normalizeWebsiteUrl(raw);
    const domain = registrableDomain(url);
    if (EXCLUDED_DOMAINS.has(domain)) return null;
    return { url, domain };
  } catch {
    return null;
  }
}

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

export const stripTags = (html: string) =>
  decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/**
 * Splits a launch title into product name and description:
 * "Show HN: Foo – AI notes for teams" → { name: "Foo", description: "AI notes for teams" }.
 */
export function splitLaunchTitle(title: string): { name: string; description: string | null } {
  const rest = title.replace(/^\s*(show|launch)\s+hn\s*:\s*/i, "").trim();
  const m = /^(.+?)(?:\s+[–—-]\s+|:\s+|\s+\|\s+)(.+)$/.exec(rest);
  const rawName = (m ? m[1]! : rest).replace(/\s*\((?:YC|yc)\s*[A-Z]?\d{2,4}\)\s*/g, " ").trim();
  return { name: rawName.slice(0, 80), description: m ? m[2]!.trim().slice(0, 300) : null };
}

interface HnHit {
  objectID: string;
  title: string | null;
  url: string | null;
  story_text?: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string;
}

async function getJson<T>(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { "User-Agent": BOT_USER_AGENT, Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url.split("?")[0]} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Hacker News "Show HN" and "Launch HN" posts via the Algolia API (free, no key), newest first,
 * above a points threshold. Text posts use the first link in the post body.
 */
export async function collectHackerNews(
  opts: { fetch?: typeof fetch; now?: Date; days?: number; minPoints?: number } = {},
): Promise<CollectorResult> {
  const fetchImpl = opts.fetch ?? fetch;
  const since = Math.floor(((opts.now ?? new Date()).getTime() - (opts.days ?? 14) * 86_400_000) / 1000);
  const base = "https://hn.algolia.com/api/v1/search_by_date";
  const queries = [
    `${base}?tags=show_hn&numericFilters=${encodeURIComponent(`points>${opts.minPoints ?? 20},created_at_i>${since}`)}&hitsPerPage=100`,
    `${base}?tags=story&query=${encodeURIComponent('"Launch HN"')}&numericFilters=${encodeURIComponent(`points>5,created_at_i>${since}`)}&hitsPerPage=50`,
  ];
  const out: CollectorResult = { candidates: [], skipped: 0, errors: [] };
  for (const q of queries) {
    try {
      const data = await getJson<{ hits: HnHit[] }>(fetchImpl, q);
      for (const hit of data.hits) {
        const title = hit.title ?? "";
        if (!/^(show|launch) hn/i.test(title)) continue;
        const bodyLink = hit.story_text ? /href="([^"]+)"/.exec(decodeEntities(hit.story_text))?.[1] : null;
        const site = toWebsite(hit.url ?? bodyLink ?? null);
        if (!site) {
          out.skipped++;
          continue;
        }
        const { name, description } = splitLaunchTitle(title);
        out.candidates.push({
          name,
          ...site,
          description,
          source: "hackernews",
          launch: {
            url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
            title,
            votes: null,
            points: hit.points ?? 0,
            comments: hit.num_comments ?? 0,
            publishedAt: hit.created_at,
            topics: [/^launch hn/i.test(title) ? "Launch HN" : "Show HN"],
          },
        });
      }
    } catch (error) {
      out.errors.push(`hackernews: ${String(error).slice(0, 200)}`);
    }
  }
  return out;
}

/**
 * Follows a Product Hunt `/r/...` redirect to the product's own site without loading it.
 * Product Hunt sometimes answers bots with a challenge page; then the entry is skipped.
 */
export async function resolveRedirect(url: string, fetchImpl: typeof fetch = fetch, hops = 4): Promise<string | null> {
  let current = url;
  for (let i = 0; i < hops; i++) {
    let host: string;
    try {
      host = new URL(current).hostname;
    } catch {
      return null;
    }
    if (!/(^|\.)producthunt\.com$/i.test(host)) return current;
    try {
      const res = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": BOT_USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) return null;
      current = new URL(location, current).toString();
    } catch {
      return null;
    }
  }
  return null;
}

interface PhPost {
  id: string;
  name: string;
  tagline: string | null;
  description?: string | null;
  url: string;
  website: string | null;
  votesCount: number;
  commentsCount: number;
  createdAt: string;
  topics?: { edges: Array<{ node: { name: string } }> };
  productLinks?: Array<{ type: string | null; url: string }>;
}

const PH_FIELDS = `id name tagline description url website votesCount commentsCount createdAt topics(first: 5) { edges { node { name } } }`;

type PhResponse<T> = { data?: T | null; errors?: Array<{ message: string }> };

/**
 * One Product Hunt GraphQL query. `productLinks` carries direct URLs; schemas without it reject the
 * whole query, so it is retried without that field.
 */
async function phQuery<T>(token: string, fetchImpl: typeof fetch, build: (fields: string) => string, variables = {}) {
  const run = (fields: string) =>
    getJson<PhResponse<T>>(fetchImpl, "https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: build(fields), variables }),
    });
  let res = await run(`${PH_FIELDS} productLinks { type url }`);
  if (!res.data && res.errors?.length) res = await run(PH_FIELDS);
  if (!res.data) throw new Error(res.errors?.map((e) => e.message).join("; ") ?? "no data");
  return res.data;
}

async function phPostToCandidate(node: PhPost, fetchImpl: typeof fetch): Promise<SourcingCandidate | null> {
  const direct = node.productLinks?.map((l) => toWebsite(l.url)).find(Boolean) ?? null;
  const site = direct ?? toWebsite(node.website ? await resolveRedirect(node.website, fetchImpl) : null);
  if (!site) return null;
  return {
    name: node.name.slice(0, 80),
    ...site,
    description: node.tagline ?? node.description?.slice(0, 300) ?? null,
    source: "producthunt",
    launch: {
      url: node.url,
      title: `${node.name} — ${node.tagline ?? ""}`.trim(),
      votes: node.votesCount,
      points: null,
      comments: node.commentsCount,
      publishedAt: node.createdAt,
      topics: node.topics?.edges.map((e) => e.node.name) ?? [],
    },
  };
}

/** Product Hunt GraphQL API v2 (needs PRODUCT_HUNT_TOKEN): newest posts with votes and topics. */
export async function collectProductHuntApi(
  token: string,
  opts: { fetch?: typeof fetch; first?: number } = {},
): Promise<CollectorResult> {
  const fetchImpl = opts.fetch ?? fetch;
  const out: CollectorResult = { candidates: [], skipped: 0, errors: [] };
  try {
    const data = await phQuery<{ posts: { edges: Array<{ node: PhPost }> } }>(
      token,
      fetchImpl,
      (fields) => `query Newest($first: Int!) { posts(order: NEWEST, first: $first) { edges { node { ${fields} } } } }`,
      { first: opts.first ?? 50 },
    );
    for (const { node } of data.posts.edges) {
      const candidate = await phPostToCandidate(node, fetchImpl);
      if (candidate) out.candidates.push(candidate);
      else out.skipped++;
    }
  } catch (error) {
    out.errors.push(`producthunt: ${String(error).slice(0, 200)}`);
  }
  return out;
}

/** One Product Hunt post by slug (manual sourcing). Null when missing or without a website. */
export async function fetchProductHuntPost(
  slug: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SourcingCandidate | null> {
  const data = await phQuery<{ post: PhPost | null }>(
    token,
    fetchImpl,
    (fields) => `query Post($slug: String!) { post(slug: $slug) { ${fields} } }`,
    { slug },
  );
  return data.post ? phPostToCandidate(data.post, fetchImpl) : null;
}

export interface FeedEntry {
  name: string;
  tagline: string | null;
  postUrl: string | null;
  redirectUrl: string | null;
  publishedAt: string | null;
}

/** Parses Product Hunt's public Atom feed (no votes; the site link is a PH redirect). */
export function parseProductHuntFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const [, body] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(body!)?.[1];
    if (!title) continue;
    const content = decodeEntities(/<content[^>]*>([\s\S]*?)<\/content>/.exec(body!)?.[1] ?? "");
    const firstP = /<p>([\s\S]*?)<\/p>/.exec(content)?.[1];
    entries.push({
      name: decodeEntities(title).trim().slice(0, 80),
      tagline: firstP ? stripTags(firstP).slice(0, 300) || null : null,
      postUrl: /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(body!)?.[1] ?? null,
      redirectUrl: /href="(https:\/\/www\.producthunt\.com\/r\/[^"]+)"/.exec(content)?.[1] ?? null,
      publishedAt: /<published>([^<]+)<\/published>/.exec(body!)?.[1] ?? null,
    });
  }
  return entries;
}

/** Product Hunt without a token: the public feed, resolving each "Link" redirect to the website. */
export async function collectProductHuntFeed(
  opts: { fetch?: typeof fetch; limit?: number } = {},
): Promise<CollectorResult> {
  const fetchImpl = opts.fetch ?? fetch;
  const out: CollectorResult = { candidates: [], skipped: 0, errors: [] };
  try {
    const res = await fetchImpl("https://www.producthunt.com/feed", {
      headers: { "User-Agent": BOT_USER_AGENT, Accept: "application/atom+xml" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`feed → HTTP ${res.status}`);
    const entries = parseProductHuntFeed(await res.text()).slice(0, opts.limit ?? 50);
    for (const e of entries) {
      const site = toWebsite(e.redirectUrl ? await resolveRedirect(e.redirectUrl, fetchImpl) : null);
      if (!site) {
        out.skipped++;
        continue;
      }
      out.candidates.push({
        name: e.name,
        ...site,
        description: e.tagline,
        source: "producthunt",
        launch: {
          url: e.postUrl,
          title: `${e.name} — ${e.tagline ?? ""}`.trim(),
          votes: null,
          points: null,
          comments: null,
          publishedAt: e.publishedAt,
          topics: [],
        },
      });
    }
    if (out.skipped && out.candidates.length === 0) {
      out.errors.push("producthunt: feed links could not be resolved (set PRODUCT_HUNT_TOKEN for the API)");
    }
  } catch (error) {
    out.errors.push(`producthunt: ${String(error).slice(0, 200)}`);
  }
  return out;
}
