/** Public URL path per article type (FR-WEB-1). Shared by web, API, CMS, feeds and notifications. */
export const ARTICLE_ROUTE_PREFIX = {
  review: "/reviews",
  comparison: "/compare",
  alternatives: "/alternatives",
  best_of: "/best",
} as const;
export type ArticleTypeKey = keyof typeof ARTICLE_ROUTE_PREFIX;

export function articlePath(type: ArticleTypeKey, slug: string): string {
  return `${ARTICLE_ROUTE_PREFIX[type]}/${slug}`;
}

export const ARTICLE_TYPE_LABEL: Record<ArticleTypeKey, string> = {
  review: "Review",
  comparison: "Comparison",
  alternatives: "Alternatives",
  best_of: "Best of",
};

/** Content locales (NFR-14; mirrors LOCALES in @repo/db). English is canonical and unprefixed. */
export const CONTENT_LOCALES = ["en", "de"] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];
export const DEFAULT_CONTENT_LOCALE: ContentLocale = "en";

export function isContentLocale(value: unknown): value is ContentLocale {
  return typeof value === "string" && (CONTENT_LOCALES as readonly string[]).includes(value);
}

/** Prefixes a site path with its locale: `/reviews/x` → `/de/reviews/x`; English stays as is. */
export function localePath(locale: string | null | undefined, path: string): string {
  if (!locale || locale === DEFAULT_CONTENT_LOCALE) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * Public path of an article in its locale. Every caller that links to an article in a given locale
 * (web, API, digest, push payloads, sitemaps) goes through this one function.
 */
export function localizedArticlePath(type: ArticleTypeKey, slug: string, locale?: string | null): string {
  return localePath(locale, articlePath(type, slug));
}
