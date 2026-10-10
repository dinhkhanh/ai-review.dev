import { SITE } from "../../lib/site";

export const revalidate = 3600;

/** Sitemap index (FR-WEB-4): one sitemap per content type. */
export function GET() {
  const types = ["pages", "reviews", "guides", "categories"];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${types.map((t) => `  <sitemap><loc>${SITE.url}/sitemaps/${t}.xml</loc></sitemap>`).join("\n")}
</sitemapindex>`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
