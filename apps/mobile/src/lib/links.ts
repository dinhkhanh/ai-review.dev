import type { AppLocale } from "./i18n";

/**
 * Deep links and outbound links (FR-API-4). The app has two content routes:
 * `/reviews/[slug]` and `/guides/[type]/[slug]`. Web URLs (universal links) and the `aireview://`
 * scheme both map onto them; German web paths carry `/de` and become `?locale=de`.
 */

export type ArticleType = "review" | "comparison" | "alternatives" | "best_of";
export type GuideType = Exclude<ArticleType, "review">;

const WEB_PREFIX: Record<ArticleType, string> = {
  review: "reviews",
  comparison: "compare",
  alternatives: "alternatives",
  best_of: "best",
};
const TYPE_BY_PREFIX = Object.fromEntries(Object.entries(WEB_PREFIX).map(([t, p]) => [p, t])) as Record<
  string,
  ArticleType
>;

export interface ArticleTarget {
  type: ArticleType;
  slug: string;
  locale: AppLocale;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

/**
 * Parses a site path (`/reviews/x`, `/de/compare/a-vs-b`) or an app path
 * (`/guides/comparison/a-vs-b`) into an article target. Returns null for anything else.
 */
export function parseArticlePath(path: string, query: URLSearchParams = new URLSearchParams()): ArticleTarget | null {
  let parts = path.split("?")[0]!.split("/").filter(Boolean);
  let locale: AppLocale = query.get("locale") === "de" ? "de" : "en";
  if (parts[0] === "de") {
    locale = "de";
    parts = parts.slice(1);
  }
  if (parts[0] === "guides" && parts.length === 3) {
    const type = parts[1] as ArticleType;
    if (type in WEB_PREFIX && type !== "review" && SLUG.test(parts[2]!)) return { type, slug: parts[2]!, locale };
    return null;
  }
  if (parts.length !== 2) return null;
  const type = TYPE_BY_PREFIX[parts[0]!];
  const slug = decodeURIComponent(parts[1]!);
  return type && SLUG.test(slug) ? { type, slug, locale } : null;
}

/** Parses any incoming URL: `aireview://reviews/x`, `https://ai-review.dev/de/reviews/x`. */
export function parseAppUrl(url: string): ArticleTarget | null {
  try {
    const u = new URL(url);
    // For custom schemes the first path segment is parsed as the host: aireview://reviews/x.
    const path = u.protocol === "aireview:" ? `/${u.host}${u.pathname}` : u.pathname;
    return parseArticlePath(path, u.searchParams);
  } catch {
    return null;
  }
}

/** App route for an article target (expo-router paths). */
export function appRoute(target: ArticleTarget): string {
  const q = target.locale === "de" ? "?locale=de" : "";
  return target.type === "review" ? `/reviews/${target.slug}${q}` : `/guides/${target.type}/${target.slug}${q}`;
}

/**
 * Maps a system path (deep link or universal link) to an app route, for `+native-intent`.
 * Unknown paths go to the home screen rather than a not-found page.
 */
export function redirectSystemPath(path: string): string {
  if (path === "/" || path === "") return "/";
  let parsed: ArticleTarget | null;
  try {
    parsed = path.includes("://") ? parseAppUrl(path) : parseArticlePath(path, new URL(path, "http://x").searchParams);
  } catch {
    parsed = null;
  }
  return parsed ? appRoute(parsed) : "/";
}

/** Canonical web URL of an article (share sheet, "open on the web"). */
export function webArticleUrl(siteUrl: string, target: ArticleTarget): string {
  const prefix = target.locale === "de" ? "/de" : "";
  return `${siteUrl.replace(/\/$/, "")}${prefix}/${WEB_PREFIX[target.type]}/${target.slug}`;
}

/**
 * Go-link for a CTA tapped in the app (FR-AFF-6). Placement `app` keeps app clicks separate in
 * click and revenue reports; the article slug attributes conversions (SubID).
 */
export function goLinkUrl(goBaseUrl: string, goSlug: string, articleSlug?: string | null): string {
  const params = new URLSearchParams({ p: "app" });
  if (articleSlug) params.set("a", articleSlug);
  return `${goBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(goSlug)}?${params}`;
}
