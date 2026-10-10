import { DEFAULT_CONTENT_LOCALE, isContentLocale } from "@repo/content";

/**
 * Path helpers that are safe in route handlers (lib/i18n.ts reads next/root-params, which only
 * works in Server Components).
 */

/** Splits a public path into its locale and the unprefixed rest: `/de/reviews/x` → de + `/reviews/x`. */
export function splitLocale(path: string): { locale: string; rest: string } {
  const [, first, ...more] = path.split("/");
  if (first && first !== DEFAULT_CONTENT_LOCALE && isContentLocale(first)) {
    return { locale: first, rest: `/${more.join("/")}`.replace(/\/$/, "") || "/" };
  }
  return { locale: DEFAULT_CONTENT_LOCALE, rest: path.replace(/\/$/, "") || "/" };
}

/**
 * The app/[locale] route path behind a public URL path, for revalidation: proxy.ts rewrites
 * `/reviews/x` to `/en/reviews/x`, so that is where the ISR entry lives. Route handlers outside
 * app/[locale] (sitemaps, API) keep their path.
 */
export function internalPath(publicPath: string): string {
  if (/^\/(api|go|media|sitemaps)(\/|$)/.test(publicPath) || /^\/(sitemap\.xml|robots\.txt)$/.test(publicPath)) {
    return publicPath;
  }
  const { locale, rest } = splitLocale(publicPath);
  return `/${locale}${rest === "/" ? "" : rest}`;
}
