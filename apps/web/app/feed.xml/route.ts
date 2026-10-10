import { listPublishedReviews } from "@repo/core";
import { getDb } from "@repo/db";
import { SITE } from "../../lib/site";

export const revalidate = 3600;

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** RSS 2.0 feed of the latest reviews (FR-WEB-4). */
export async function GET() {
  const reviews = await listPublishedReviews(getDb(), { limit: 50 });
  const items = reviews
    .map(
      (r) => `    <item>
      <title>${esc(r.title)}</title>
      <link>${SITE.url}/reviews/${r.slug}</link>
      <guid isPermaLink="true">${SITE.url}/reviews/${r.slug}</guid>
      ${r.publishedAt ? `<pubDate>${r.publishedAt.toUTCString()}</pubDate>` : ""}
      ${r.metaDescription ? `<description>${esc(r.metaDescription)}</description>` : ""}
      ${r.categoryName ? `<category>${esc(r.categoryName)}</category>` : ""}
    </item>`,
    )
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE.name)}</title>
    <link>${SITE.url}</link>
    <description>${esc(SITE.description)}</description>
    <language>en</language>
    <atom:link href="${SITE.url}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
