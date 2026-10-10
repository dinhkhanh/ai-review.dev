import {
  ARTICLE_ROUTE_PREFIX,
  DEFAULT_CONTENT_LOCALE,
  isContentLocale,
  localePath,
  type ArticleTypeKey,
} from "@repo/content";
import { findArticleTranslation, getSetting } from "@repo/core";
import { getDb } from "@repo/db";
import type { NextRequest } from "next/server";
import { splitLocale } from "../../../lib/locale-path";
import { STATIC_PAGE_PATHS } from "../../../lib/static-pages";

/** Pages that exist in every locale under the same path. */
const SHARED_PATHS = new Set<string>([
  "/",
  "/reviews",
  "/compare",
  "/alternatives",
  "/best",
  "/deals",
  "/search",
  "/report",
  ...STATIC_PAGE_PATHS,
]);

const TYPE_BY_PREFIX = new Map<string, ArticleTypeKey>(
  Object.entries(ARTICLE_ROUTE_PREFIX).map(([type, prefix]) => [prefix, type as ArticleTypeKey]),
);

/**
 * Language switcher target (phase 3): the translated article when it is live, the same page for
 * shared pages (indexes, categories, policies), otherwise the target locale's home. Disabled
 * locales send visitors home in the current locale.
 */
export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const from = request.nextUrl.searchParams.get("from") ?? "/";
  const go = (path: string) => Response.redirect(new URL(path, request.url), 303);
  const fromPath = from.startsWith("/") && !from.startsWith("//") ? from.slice(0, 300) : "/";
  const { locale: fromLocale, rest } = splitLocale(fromPath);
  if (!isContentLocale(to)) return go(localePath(fromLocale, "/"));
  if (to !== DEFAULT_CONTENT_LOCALE) {
    const policy = await getSetting(getDb(), "i18n.policy").catch(() => null);
    if (!policy?.enabledLocales.includes(to)) return go(localePath(fromLocale, "/"));
  }
  if (SHARED_PATHS.has(rest) || /^\/categories\/[^/]+$/.test(rest)) return go(localePath(to, rest));
  const match = /^(\/[a-z]+)\/([^/]+)$/.exec(rest);
  const type = match ? TYPE_BY_PREFIX.get(match[1]!) : undefined;
  if (match && type) {
    const translation = await findArticleTranslation(getDb(), {
      type,
      slug: decodeURIComponent(match[2]!),
      fromLocale,
      toLocale: to,
    });
    if (translation) return go(translation.path);
  }
  return go(localePath(to, "/"));
}
