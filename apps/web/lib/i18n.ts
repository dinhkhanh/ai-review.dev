// Locales on the public site (phase 3). English is canonical and unprefixed; German lives under
// /de. `proxy.ts` rewrites unprefixed URLs to /en internally, so every page sits under
// app/[locale] and reads its locale from the root param. A locale is public only when listed in
// the `i18n.policy` setting; until then its pages 404.
import {
  CONTENT_LOCALES,
  DEFAULT_CONTENT_LOCALE,
  isContentLocale,
  localePath,
  type ContentLocale,
} from "@repo/content";
import { getArticleTranslations, getSetting, type ArticleTranslation } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { cache } from "react";
import { messagesFor, type Messages } from "./messages";
import { absoluteUrl } from "./site";

export { formatDate, MESSAGES, messagesFor, type Messages } from "./messages";

/** Locales listed in `i18n.policy.enabledLocales` (English always). Cached per render. */
export const enabledLocales = cache(async (): Promise<ContentLocale[]> => {
  try {
    const policy = await getSetting(getDb(), "i18n.policy");
    const listed = (policy?.enabledLocales ?? []).filter(isContentLocale);
    return CONTENT_LOCALES.filter((l) => l === DEFAULT_CONTENT_LOCALE || listed.includes(l));
  } catch {
    return [DEFAULT_CONTENT_LOCALE];
  }
});

/** The locale of the current route (layouts, components); falls back to English. */
export async function currentLocale(): Promise<ContentLocale> {
  const value = await rootLocale();
  return isContentLocale(value) ? value : DEFAULT_CONTENT_LOCALE;
}

/** For pages: the route locale, or a 404 when it is unknown or not public yet. */
export async function pageLocale(): Promise<ContentLocale> {
  const value = await rootLocale();
  if (!isContentLocale(value)) notFound();
  if (value !== DEFAULT_CONTENT_LOCALE && !(await enabledLocales()).includes(value)) notFound();
  return value;
}

/** Messages for the current route. */
export async function getMessages(): Promise<Messages> {
  return messagesFor(await currentLocale());
}

/**
 * hreflang alternates (FR-WEB-4): one entry per locale plus x-default (English). Returns undefined
 * unless at least two locales are available, so single-language pages carry no alternates.
 */
export function languageAlternates(paths: Partial<Record<string, string>>): Record<string, string> | undefined {
  const entries = Object.entries(paths).filter((e): e is [string, string] => !!e[1]);
  if (entries.length < 2) return undefined;
  const languages = Object.fromEntries(entries.map(([l, p]) => [l, absoluteUrl(p)]));
  const fallback = paths[DEFAULT_CONTENT_LOCALE];
  return fallback ? { ...languages, "x-default": absoluteUrl(fallback) } : languages;
}

/**
 * Canonical + alternates for pages that exist in every public locale (home, indexes, policies).
 * `path` is the unprefixed path, e.g. "/reviews".
 */
export async function pageAlternates(path: string, locale: ContentLocale): Promise<Metadata["alternates"]> {
  const locales = await enabledLocales();
  return {
    canonical: absoluteUrl(localePath(locale, path)),
    languages: languageAlternates(Object.fromEntries(locales.map((l) => [l, localePath(l, path)]))),
  };
}

/** Feed URL for a locale (RSS lives at /feed.xml and /de/feed.xml). */
export const feedPath = (locale: string) => localePath(locale, "/feed.xml");

/** Live translations of an article in public locales (hreflang, "also available in"). */
export const publicTranslations = cache(async (articleId: string): Promise<ArticleTranslation[]> => {
  const [translations, locales] = await Promise.all([
    getArticleTranslations(getDb(), articleId).catch(() => []),
    enabledLocales(),
  ]);
  return translations.filter((t) => (locales as string[]).includes(t.locale));
});

/** Canonical + hreflang for an article: alternates only when another locale's version is live. */
export async function articleAlternates(articleId: string, canonicalPath: string): Promise<Metadata["alternates"]> {
  const translations = await publicTranslations(articleId);
  return {
    canonical: absoluteUrl(canonicalPath),
    languages: languageAlternates(Object.fromEntries(translations.map((t) => [t.locale, t.path]))),
  };
}

/** Metadata for static policy pages: localised title and description, canonical + hreflang. */
export async function staticPageMetadata(
  path: string,
  pick: (t: Messages) => { title: string; description?: string },
): Promise<Metadata> {
  const locale = await pageLocale();
  const { title, description } = pick(messagesFor(locale));
  return { title, description, alternates: await pageAlternates(path, locale) };
}
