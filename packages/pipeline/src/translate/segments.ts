import { parseInline, serializeInline, type Block, type Citation, type Inline } from "@repo/content";

/**
 * Translation segments: every human-readable string of an article's blocks, keyed by
 * `<blockId>|<field path>`. Structure (block types, ids, order, CTA go-slugs and placements,
 * citations, scores, prices, URLs) is never sent to the model; it is copied from the source and
 * only the text is replaced, so a translation cannot change the article's shape.
 *
 * Inline fields use the editor's inline syntax with citations written as `[^C<n>]` tokens that map
 * back to the exact source citation (source id and quote).
 */
export interface Segment {
  key: string;
  blockId: string;
  /** Text sent to the model (inline syntax for rich fields). */
  text: string;
  /** Whether `text` is inline syntax (paragraphs, list items, FAQ answers, callouts). */
  inline: boolean;
}

export interface SegmentSet {
  segments: Segment[];
  /** `C<n>` → the citation it stands for. */
  citations: Map<string, Citation>;
}

/** Serialises inline content with one `[^C<n>]` token per citation occurrence. */
function serializeWithTokens(inlines: Inline[], citations: Map<string, Citation>): string {
  const tokenized = inlines.map((seg) => ({
    text: seg.text,
    marks: seg.marks.map((m) => {
      if (m.type !== "citation") return m;
      const token = `C${citations.size + 1}`;
      citations.set(token, m.citation);
      return { type: "citation" as const, citation: { sourceId: token } };
    }),
  }));
  return serializeInline(tokenized);
}

/** Parses translated inline text, mapping `[^C<n>]` tokens back to their citations (unknown tokens dropped). */
export function parseWithTokens(text: string, citations: Map<string, Citation>): Inline[] {
  const parsed = parseInline(text, { resolveCitation: (ref) => (citations.has(ref) ? ref : null) });
  return parsed.map((seg) => ({
    text: seg.text,
    marks: seg.marks.map((m) =>
      m.type === "citation" ? { type: "citation" as const, citation: citations.get(m.citation.sourceId)! } : m,
    ),
  }));
}

/** Extracts the translatable segments of `blocks`, in reading order. */
export function extractSegments(blocks: Block[], citations: Map<string, Citation> = new Map()): SegmentSet {
  const segments: Segment[] = [];
  const plain = (b: Block, path: string, text: string | undefined) => {
    if (text && text.trim()) segments.push({ key: `${b.id}|${path}`, blockId: b.id, text, inline: false });
  };
  const rich = (b: Block, path: string, inlines: Inline[]) => {
    const text = serializeWithTokens(inlines, citations);
    if (text.trim()) segments.push({ key: `${b.id}|${path}`, blockId: b.id, text, inline: true });
  };
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        plain(b, "text", b.text);
        break;
      case "paragraph":
      case "callout":
        rich(b, "children", b.children);
        break;
      case "list":
        b.items.forEach((item, i) => rich(b, `items.${i}`, item));
        break;
      case "verdict":
        plain(b, "summary", b.summary);
        b.bestFor.forEach((t, i) => plain(b, `bestFor.${i}`, t));
        b.notFor.forEach((t, i) => plain(b, `notFor.${i}`, t));
        break;
      case "rubric":
        b.dimensions.forEach((d, i) => {
          plain(b, `dimensions.${i}.label`, d.label);
          plain(b, `dimensions.${i}.justification`, d.justification);
        });
        break;
      case "pricing_table":
        b.tiers.forEach((t, i) => t.highlights.forEach((h, j) => plain(b, `tiers.${i}.highlights.${j}`, h)));
        break;
      case "pros_cons":
        b.pros.forEach((t, i) => plain(b, `pros.${i}`, t));
        b.cons.forEach((t, i) => plain(b, `cons.${i}`, t));
        break;
      case "comparison_table":
        b.rows.forEach((r, i) => {
          plain(b, `rows.${i}.label`, r.label);
          r.values.forEach((v, j) => plain(b, `rows.${i}.values.${j}`, v));
        });
        break;
      case "image":
        plain(b, "caption", b.caption);
        break;
      case "faq":
        b.items.forEach((item, i) => {
          plain(b, `items.${i}.question`, item.question);
          rich(b, `items.${i}.answer`, item.answer);
        });
        break;
      case "cta":
        plain(b, "label", b.label);
        plain(b, "note", b.note);
        break;
      case "video":
      case "sources":
        break;
    }
  }
  return { segments, citations };
}

/**
 * Returns `blocks` with translated text applied. Segments missing from `translated` keep the
 * source text (and are reported by the QA as untranslated).
 */
export function applySegments(blocks: Block[], set: SegmentSet, translated: Map<string, string>): Block[] {
  const t = (b: Block, path: string, fallback: string) => translated.get(`${b.id}|${path}`) ?? fallback;
  const inl = (b: Block, path: string, fallback: Inline[]) => {
    const text = translated.get(`${b.id}|${path}`);
    return text === undefined ? fallback : parseWithTokens(text, set.citations);
  };
  return blocks.map((b): Block => {
    switch (b.type) {
      case "heading":
        return { ...b, text: t(b, "text", b.text) };
      case "paragraph":
      case "callout":
        return { ...b, children: inl(b, "children", b.children) };
      case "list":
        return { ...b, items: b.items.map((item, i) => inl(b, `items.${i}`, item)) };
      case "verdict":
        return {
          ...b,
          summary: t(b, "summary", b.summary),
          bestFor: b.bestFor.map((x, i) => t(b, `bestFor.${i}`, x)),
          notFor: b.notFor.map((x, i) => t(b, `notFor.${i}`, x)),
        };
      case "rubric":
        return {
          ...b,
          dimensions: b.dimensions.map((d, i) => ({
            ...d,
            label: t(b, `dimensions.${i}.label`, d.label),
            justification: t(b, `dimensions.${i}.justification`, d.justification),
          })),
        };
      case "pricing_table":
        return {
          ...b,
          tiers: b.tiers.map((tier, i) => ({
            ...tier,
            highlights: tier.highlights.map((h, j) => t(b, `tiers.${i}.highlights.${j}`, h)),
          })),
        };
      case "pros_cons":
        return {
          ...b,
          pros: b.pros.map((x, i) => t(b, `pros.${i}`, x)),
          cons: b.cons.map((x, i) => t(b, `cons.${i}`, x)),
        };
      case "comparison_table":
        return {
          ...b,
          rows: b.rows.map((r, i) => ({
            label: t(b, `rows.${i}.label`, r.label),
            values: r.values.map((v, j) => t(b, `rows.${i}.values.${j}`, v)),
          })),
        };
      case "image":
        return b.caption ? { ...b, caption: t(b, "caption", b.caption) } : b;
      case "faq":
        return {
          ...b,
          items: b.items.map((item, i) => ({
            question: t(b, `items.${i}.question`, item.question),
            answer: inl(b, `items.${i}.answer`, item.answer),
          })),
        };
      case "cta":
        return { ...b, label: t(b, "label", b.label), ...(b.note ? { note: t(b, "note", b.note) } : {}) };
      default:
        return b;
    }
  });
}

const CITATION_TOKEN = /\[\^(C\d+)\]/g;
const LINK_TARGET = /\]\(([^)\s]+)\)/g;

/** Citation tokens, link targets (URLs and go: links) and plain text of one segment's text. */
export function segmentMarkers(text: string) {
  const tokens = [...text.matchAll(CITATION_TOKEN)].map((m) => m[1]!);
  const targets = [...text.matchAll(LINK_TARGET)].map((m) => m[1]!);
  const plainText = text
    .replace(CITATION_TOKEN, "")
    .replace(LINK_TARGET, "]")
    .replace(/[[\]*`\\]/g, "");
  return { tokens, targets, plainText };
}

/**
 * Problems with one translated segment against its source: lost citation tokens, changed link
 * targets. Used to retry and repair before the article-level QA runs.
 */
export function segmentProblems(source: Segment, translated: string): string[] {
  if (!source.inline) return [];
  const a = segmentMarkers(source.text);
  const b = segmentMarkers(translated);
  const problems: string[] = [];
  const missingTokens = a.tokens.filter((tok) => !b.tokens.includes(tok));
  if (missingTokens.length) problems.push(`missing citation markers ${missingTokens.map((x) => `[^${x}]`).join(" ")}`);
  const missingTargets = a.targets.filter((x) => !b.targets.includes(x));
  if (missingTargets.length) problems.push(`link targets must stay unchanged: ${missingTargets.join(", ")}`);
  return problems;
}

/** Deterministic repair: appends citation tokens the model dropped, so no claim loses its source. */
export function repairCitations(source: Segment, translated: string): { text: string; repaired: number } {
  if (!source.inline) return { text: translated, repaired: 0 };
  const have = new Set(segmentMarkers(translated).tokens);
  const missing = segmentMarkers(source.text).tokens.filter((tok) => !have.has(tok));
  if (!missing.length) return { text: translated, repaired: 0 };
  return { text: `${translated.trimEnd()}${missing.map((tok) => `[^${tok}]`).join("")}`, repaired: missing.length };
}
