import type { Block, Inline } from "@repo/content";
import { translate, type AppLocale } from "./i18n";

/**
 * Pure helpers behind the native block renderer (constraint C-1, NFR-13): the renderer only maps
 * these view models to React Native components, so the logic is testable without a device.
 */

export type BlockType = Block["type"];

/** Every block type the app renders. A test checks this against @repo/content's schema. */
export const RENDERED_BLOCK_TYPES: readonly BlockType[] = [
  "heading",
  "paragraph",
  "list",
  "verdict",
  "rubric",
  "pricing_table",
  "pros_cons",
  "comparison_table",
  "image",
  "video",
  "faq",
  "cta",
  "callout",
  "sources",
];

export interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** External link. */
  href?: string;
  /** Monetised link through the go-link redirect. */
  goSlug?: string;
  /** 1-based number of the cited source, rendered as a superscript marker after the text. */
  citation?: number;
}

/**
 * Flattens inline runs into styled segments. Citation marks become numbered markers that match
 * the order of the article's source list (first citation = 1), like the web renderer.
 */
export function inlineSegments(inlines: Inline[], sourceNumbers: Map<string, number>): Segment[] {
  const out: Segment[] = [];
  for (const run of inlines) {
    const seg: Segment = { text: run.text };
    const citations: number[] = [];
    for (const mark of run.marks ?? []) {
      if (mark.type === "bold") seg.bold = true;
      else if (mark.type === "italic") seg.italic = true;
      else if (mark.type === "code") seg.code = true;
      else if (mark.type === "link") seg.href = mark.href;
      else if (mark.type === "golink") seg.goSlug = mark.slug;
      else if (mark.type === "citation") {
        const n = sourceNumbers.get(mark.citation.sourceId);
        if (n) citations.push(n);
      }
    }
    if (seg.text) out.push(seg);
    for (const n of [...new Set(citations)]) out.push({ text: "", citation: n });
  }
  return out;
}

/** Plain text of inline runs (accessibility labels, share text). */
export const inlineText = (inlines: Inline[]) => inlines.map((r) => r.text).join("");

/** Numbers sources in order of first citation, then any uncited ones, for markers and the list. */
export function numberSources(blocks: Block[], sourceIds: string[]): Map<string, number> {
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
  const known = new Set(sourceIds);
  const numbered = order.filter((id) => known.has(id));
  for (const id of sourceIds) if (!numbered.includes(id)) numbered.push(id);
  return new Map(numbered.map((id, i) => [id, i + 1]));
}

export function formatScore(score: number | null | undefined): string | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  return (Math.round(score * 10) / 10).toFixed(1);
}

export interface TierLike {
  price: number | null;
  currency: string;
  period: "month" | "year" | "one_time" | "usage" | "custom";
}

export function formatTierPrice(tier: TierLike, locale: AppLocale): string {
  if (tier.price === null) return translate(locale, "price.custom");
  if (tier.price === 0) return translate(locale, "price.free");
  let amount: string;
  try {
    amount = new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-US", {
      style: "currency",
      currency: tier.currency,
      maximumFractionDigits: tier.price % 1 === 0 ? 0 : 2,
    }).format(tier.price);
  } catch {
    amount = `${tier.price} ${tier.currency}`;
  }
  return `${amount}${translate(locale, `period.${tier.period}`)}`;
}

/** Comparison-table header names from the guide's product list, falling back to "Product n". */
export function comparisonHeaders(productIds: string[], products: Array<{ id: string; name: string }>): string[] {
  return productIds.map((id, i) => products.find((p) => p.id === id)?.name ?? `Product ${i + 1}`);
}

/** Whether an article has any monetised link, which decides if the affiliate disclosure shows. */
export function hasMonetisedLinks(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === "cta" || JSON.stringify(b).includes('"type":"golink"'));
}
