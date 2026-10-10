import { DEFAULT_CONTENT_LOCALE, isContentLocale, localePath, localizedArticlePath } from "@repo/content";
import { getSetting, listPublishedArticles } from "@repo/core";
import { getDb } from "@repo/db";
import { messagesFor } from "../../../lib/messages";
import { SITE } from "../../../lib/site";

export const revalidate = 3600;

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * RSS 2.0 feed of the latest reviews, comparisons and lists (FR-WEB-4), one per public locale:
 * /feed.xml (English, via proxy rewrite) and /de/feed.xml.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isContentLocale(locale)) return new Response("Not found", { status: 404 });
  const db = getDb();
  if (locale !== DEFAULT_CONTENT_LOCALE) {
    const policy = await getSetting(db, "i18n.policy").catch(() => null);
    if (!policy?.enabledLocales.includes(locale)) return new Response("Not found", { status: 404 });
  }
  const t = messagesFor(locale);
  const home = `${SITE.url}${localePath(locale, "/")}`;
  const self = `${SITE.url}${localePath(locale, "/feed.xml")}`;
  const reviews = await listPublishedArticles(db, { limit: 50, locale });
  const items = reviews
    .map((r) => {
      const url = `${SITE.url}${localizedArticlePath(r.type, r.slug, r.locale)}`;
      return `    <item>
      <title>${esc(r.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      ${r.publishedAt ? `<pubDate>${r.publishedAt.toUTCString()}</pubDate>` : ""}
      ${r.metaDescription ? `<description>${esc(r.metaDescription)}</description>` : ""}
      ${r.categoryName ? `<category>${esc(r.categoryName)}</category>` : ""}
    </item>`;
    })
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE.name)}</title>
    <link>${home}</link>
    <description>${esc(t.site.description)}</description>
    <language>${t.rssLanguage}</language>
    <atom:link href="${self}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
