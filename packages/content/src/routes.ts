/** Public URL path per article type (FR-WEB-1). Shared by web, API, CMS, feeds and notifications. */
export const ARTICLE_ROUTE_PREFIX = {
  review: "/reviews",
  comparison: "/compare",
  alternatives: "/alternatives",
  best_of: "/best",
} as const;
export type ArticleTypeKey = keyof typeof ARTICLE_ROUTE_PREFIX;

export function articlePath(type: ArticleTypeKey, slug: string): string {
  return `${ARTICLE_ROUTE_PREFIX[type]}/${slug}`;
}

export const ARTICLE_TYPE_LABEL: Record<ArticleTypeKey, string> = {
  review: "Review",
  comparison: "Comparison",
  alternatives: "Alternatives",
  best_of: "Best of",
};
