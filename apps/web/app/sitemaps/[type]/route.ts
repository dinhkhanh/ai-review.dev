import { listCategoriesWithCounts, publishedSitemapEntries } from "@repo/core";
import { getDb } from "@repo/db";
import { SITE } from "../../../lib/site";
import { STATIC_PAGES } from "../../../lib/static-pages";

export const revalidate = 3600;
export const dynamicParams = false;
export function generateStaticParams() {
  return ["pages.xml", "reviews.xml", "categories.xml"].map((type) => ({ type }));
}

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

function urlset(entries: Array<{ loc: string; lastmod?: Date | null }>) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) =>
      `  <url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.toISOString()}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const db = getDb();
  let entries: Array<{ loc: string; lastmod?: Date | null }>;
  switch (type.replace(/\.xml$/, "")) {
    case "pages":
      entries = [
        { loc: SITE.url },
        { loc: `${SITE.url}/reviews` },
        ...STATIC_PAGES.map((p) => ({ loc: `${SITE.url}${p.path}` })),
      ];
      break;
    case "reviews":
      entries = (await publishedSitemapEntries(db))
        .filter((r) => r.type === "review")
        .map((r) => ({ loc: `${SITE.url}/reviews/${r.slug}`, lastmod: r.updatedAt }));
      break;
    case "categories":
      entries = (await listCategoriesWithCounts(db))
        .filter((c) => c.reviews > 0)
        .map((c) => ({ loc: `${SITE.url}/categories/${c.slug}` }));
      break;
    default:
      return new Response("Not found", { status: 404 });
  }
  return new Response(urlset(entries), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
