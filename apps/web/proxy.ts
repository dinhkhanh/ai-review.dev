import { NextResponse, type NextRequest } from "next/server";

/** Locales served under a path prefix. Keep in sync with CONTENT_LOCALES in @repo/content. */
const PREFIXED_LOCALES = ["de"];
const DEFAULT_LOCALE = "en";

/**
 * Locale routing (phase 3). Pages live under app/[locale]; English keeps its unprefixed URLs, so
 * `/reviews/x` is rewritten to `/en/reviews/x` internally and `/en/...` redirects to the clean URL.
 * German is served as is under `/de/...`. No Accept-Language redirects: every URL shows one
 * language, which is what search engines expect with hreflang.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Files (IndexNow key, icons) are not pages; the RSS feed is, per locale.
  if (/\.[a-z0-9]+$/i.test(pathname) && !pathname.endsWith("/feed.xml")) return NextResponse.next();
  const first = pathname.split("/")[1] ?? "";
  if (PREFIXED_LOCALES.includes(first)) return NextResponse.next();
  if (first === DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(DEFAULT_LOCALE.length + 1) || "/";
    return NextResponse.redirect(url, 308);
  }
  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Route handlers outside app/[locale]: API, go-links, media, sitemaps, app links and Next internals.
  matcher: ["/((?!api/|_next/|go/|media/|sitemaps/|\\.well-known/).*)"],
};
