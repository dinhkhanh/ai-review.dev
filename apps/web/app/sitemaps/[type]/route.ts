import { DEFAULT_CONTENT_LOCALE, localePath, localizedArticlePath } from "@repo/content";
import { getSetting, listCategoriesWithCounts, publishedSitemapEntries } from "@repo/core";
import { getDb, type DbOrTx } from "@repo/db";
import { SITE } from "../../../lib/site";
import { STATIC_PAGE_PATHS } from "../../../lib/static-pages";

export const revalidate = 3600;
export const dynamicParams = false;
export function generateStaticParams() {
  return ["pages.xml", "reviews.xml", "guides.xml", "categories.xml"].map((type) => ({ type }));
}

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** One URL with optional hreflang alternates (each alternate set lists every locale incl. itself). */
interface SitemapEntry {
  loc: string;
  lastmod?: Date | null;
  alternates?: Array<{ hreflang: string; href: string }>;
}

function urlset(entries: SitemapEntry[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries
  .map(
    (e) =>
      `  <url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.toISOString()}</lastmod>` : ""}${(
        e.alternates ?? []
      )
        .map((a) => `<xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${xmlEscape(a.href)}"/>`)
        .join("")}</url>`,
  )
  .join("\n")}
</urlset>`;
}

/** hreflang set for one page available in `paths` (locale → path); empty for a single locale. */
function alternatesFor(paths: Map<string, string>): SitemapEntry["alternates"] {
  if (paths.size < 2) return undefined;
  const links = [...paths].map(([hreflang, path]) => ({ hreflang, href: `${SITE.url}${path}` }));
  const fallback = paths.get(DEFAULT_CONTENT_LOCALE);
  return fallback ? [...links, { hreflang: "x-default", href: `${SITE.url}${fallback}` }] : links;
}

async function publicLocales(db: DbOrTx): Promise<string[]> {
  const policy = await getSetting(db, "i18n.policy").catch(() => null);
  return [DEFAULT_CONTENT_LOCALE, ...(policy?.enabledLocales ?? []).filter((l) => l !== DEFAULT_CONTENT_LOCALE)];
}

/** Same page in every public locale (indexes, policies, categories). */
function everyLocale(locales: string[], path: string, lastmod?: Date | null): SitemapEntry[] {
  const paths = new Map(locales.map((l) => [l, localePath(l, path)]));
  const alternates = alternatesFor(paths);
  return [...paths.values()].map((p) => ({ loc: `${SITE.url}${p}`, lastmod, alternates }));
}

/** Articles grouped by translation (source id), each URL listing its live siblings (FR-WEB-4). */
async function articleEntries(db: DbOrTx, locales: string[], keep: (type: string) => boolean) {
  const rows = (await publishedSitemapEntries(db, { locales })).filter((r) => keep(r.type));
  const groups = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const group = groups.get(r.groupId) ?? new Map<string, string>();
    if (!group.has(r.locale)) group.set(r.locale, localizedArticlePath(r.type, r.slug, r.locale));
    groups.set(r.groupId, group);
  }
  return rows.map((r) => ({
    loc: `${SITE.url}${localizedArticlePath(r.type, r.slug, r.locale)}`,
    lastmod: r.updatedAt,
    alternates: alternatesFor(groups.get(r.groupId)!),
  }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const db = getDb();
  const locales = await publicLocales(db);
  let entries: SitemapEntry[];
  switch (type.replace(/\.xml$/, "")) {
    case "pages":
      entries = ["/", "/reviews", "/compare", "/alternatives", "/best", "/deals", ...STATIC_PAGE_PATHS].flatMap((p) =>
        everyLocale(locales, p),
      );
      break;
    case "reviews":
      entries = await articleEntries(db, locales, (t) => t === "review");
      break;
    case "guides":
      entries = await articleEntries(db, locales, (t) => t !== "review");
      break;
    case "categories": {
      // A category page is listed in a locale once it has a review in that locale.
      const perLocale = await Promise.all(
        locales.map(async (l) => ({
          l,
          slugs: (await listCategoriesWithCounts(db, { locale: l })).filter((c) => c.reviews > 0),
        })),
      );
      const bySlug = new Map<string, Map<string, string>>();
      for (const { l, slugs } of perLocale) {
        for (const c of slugs) {
          const paths = bySlug.get(c.slug) ?? new Map<string, string>();
          paths.set(l, localePath(l, `/categories/${c.slug}`));
          bySlug.set(c.slug, paths);
        }
      }
      entries = [...bySlug.values()].flatMap((paths) => {
        const alternates = alternatesFor(paths);
        return [...paths.values()].map((p) => ({ loc: `${SITE.url}${p}`, alternates }));
      });
      break;
    }
    default:
      return new Response("Not found", { status: 404 });
  }
  return new Response(urlset(entries), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
