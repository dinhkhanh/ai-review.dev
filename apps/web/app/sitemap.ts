import type { MetadataRoute } from "next";
import { SITE } from "../lib-site";

export const revalidate = 3600;

/** Phase 0: home only. Phase 1 splits sitemaps by type (reviews, comparisons, categories) — FR-WEB-4. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE.url, changeFrequency: "daily", priority: 1 }];
}
