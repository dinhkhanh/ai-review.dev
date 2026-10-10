import { messagesFor } from "./messages";

/** Static policy/info pages (FR-WEB-1), listed in the sitemap and footer, in every locale. */
const PAGES = [
  { path: "/about", key: "about" },
  { path: "/editorial-policy", key: "editorialPolicy" },
  { path: "/affiliate-disclosure", key: "affiliateDisclosure" },
  { path: "/privacy", key: "privacy" },
  { path: "/terms", key: "terms" },
  { path: "/contact", key: "contact" },
  // Legal notice (German TMG/DDG § 5): linked from every page footer, required for the German site.
  { path: "/impressum", key: "impressum" },
] as const;

export const STATIC_PAGE_PATHS = PAGES.map((p) => p.path);

export function staticPages(locale: string) {
  const t = messagesFor(locale);
  return PAGES.map((p) => ({ path: p.path, title: t.pages[p.key] }));
}
