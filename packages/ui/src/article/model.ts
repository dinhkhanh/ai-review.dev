import type { ArticleBody, Block, Inline } from "@repo/content";

/** Everything the renderer needs, already resolved to URLs (no DB types, mobile-portable shape). */
export interface RenderMedia {
  url: string;
  srcSet?: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

export interface RenderSource {
  id: string;
  url: string;
  title: string | null;
  kind: string;
  fetchedAt: string | Date;
}

export interface RenderModel {
  blocks: ArticleBody;
  media: Record<string, RenderMedia>;
  sources: RenderSource[];
  /** Product names (and internal review links) for comparison tables. */
  products: Record<string, { name: string; href?: string | null }>;
  /** Go-link href builder; defaults to /go/<slug>?p=<placement>. */
  goHref?: (slug: string, placement: string) => string;
  /** CTA targets that must bypass the redirect (programs that forbid cloaking, C-2). */
  directLinks?: Record<string, string>;
  /** "Report a change" link for pricing tables (FR-WEB-6). */
  reportHref?: string | null;
  disclosureHref?: string;
}

export function defaultGoHref(slug: string, placement: string) {
  return `/go/${encodeURIComponent(slug)}?p=${encodeURIComponent(placement)}`;
}

function inlinesOf(block: Block): Inline[][] {
  switch (block.type) {
    case "paragraph":
    case "callout":
      return [block.children];
    case "list":
      return block.items;
    case "faq":
      return block.items.map((i) => i.answer);
    default:
      return [];
  }
}

/** True when the article contains any monetised link (FR-AFF-14 disclosure trigger). */
export function hasMonetisedLinks(blocks: ArticleBody): boolean {
  return blocks.some(
    (b) => b.type === "cta" || inlinesOf(b).some((line) => line.some((s) => s.marks.some((m) => m.type === "golink"))),
  );
}

/** Source numbering by first citation, so footnote [1] is the first source cited. */
export function citationOrder(blocks: ArticleBody): string[] {
  const order: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.sourceId === "string" && !order.includes(obj.sourceId)) order.push(obj.sourceId);
      Object.values(obj).forEach(visit);
    }
  };
  visit(blocks);
  return order;
}

export function headingId(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "section"
  );
}

/** Table of contents from H2 headings. */
export function tableOfContents(blocks: ArticleBody) {
  return blocks.flatMap((b) =>
    b.type === "heading" && b.level === 2 ? [{ id: headingId(b.text), text: b.text }] : [],
  );
}
