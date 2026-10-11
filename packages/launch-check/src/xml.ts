import { decodeEntities } from "./html.ts";

/** `<loc>` values of a sitemap index or urlset. */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]!));
}

export function sitemapKind(xml: string): "index" | "urlset" | null {
  if (/<sitemapindex\b/i.test(xml)) return "index";
  if (/<urlset\b/i.test(xml)) return "urlset";
  return null;
}

export type Feed = { kind: "rss" | "atom"; title: string | null; items: number; selfLink: boolean };

export function parseFeed(xml: string): Feed | null {
  if (/<rss\b/i.test(xml) && /<channel\b/i.test(xml)) {
    const title = xml.match(/<channel\b[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/i)?.[1] ?? null;
    return {
      kind: "rss",
      title: title ? decodeEntities(title.replace(/<!\[CDATA\[|\]\]>/g, "").trim()) : null,
      items: (xml.match(/<item\b/gi) ?? []).length,
      selfLink: /<atom:link\b[^>]*rel=["']self["']/i.test(xml),
    };
  }
  if (/<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml)) {
    const title = xml.match(/<feed\b[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
    return {
      kind: "atom",
      title: title ? decodeEntities(title.trim()) : null,
      items: (xml.match(/<entry\b/gi) ?? []).length,
      selfLink: /<link\b[^>]*rel=["']self["']/i.test(xml),
    };
  }
  return null;
}
