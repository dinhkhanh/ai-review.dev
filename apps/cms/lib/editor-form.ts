import { computeOverallScore, parseInline, serializeInline, type ArticleBody, type Block } from "@repo/content";
import type { RefMap } from "@repo/pipeline/editor";

/**
 * Block editor <-> form fields (FR-CMS-5). Field names: `b:<blockId>:<field>`. Inline text uses
 * the editor syntax with S-ref citations ([^S3]); lists are one item per line.
 */
export const field = (blockId: string, name: string) => `b:${blockId}:${name}`;

export function toMd(inl: Parameters<typeof serializeInline>[0], refs: RefMap) {
  return serializeInline(inl, { citationRef: refs.ref });
}

const lines = (v: string) =>
  v
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Applies submitted fields to blocks; returns new blocks and the ids that changed. */
export function applyEditorForm(
  blocks: ArticleBody,
  form: FormData,
  refs: RefMap,
): { blocks: ArticleBody; changed: string[] } {
  const get = (id: string, name: string) => {
    const v = form.get(field(id, name));
    return typeof v === "string" ? v : null;
  };
  const parse = (s: string) => parseInline(s.trim(), { resolveCitation: refs.id });
  const next = blocks.map((b): Block => {
    switch (b.type) {
      case "heading": {
        const text = get(b.id, "text");
        return text !== null ? { ...b, text: text.trim() } : b;
      }
      case "paragraph":
      case "callout": {
        const md = get(b.id, "md");
        return md !== null ? { ...b, children: parse(md) } : b;
      }
      case "list": {
        const md = get(b.id, "md");
        return md !== null ? { ...b, items: lines(md).map(parse) } : b;
      }
      case "verdict": {
        const summary = get(b.id, "summary");
        const bestFor = get(b.id, "bestFor");
        const notFor = get(b.id, "notFor");
        return {
          ...b,
          ...(summary !== null ? { summary: summary.trim() } : {}),
          ...(bestFor !== null ? { bestFor: lines(bestFor) } : {}),
          ...(notFor !== null ? { notFor: lines(notFor) } : {}),
        };
      }
      case "pros_cons": {
        const pros = get(b.id, "pros");
        const cons = get(b.id, "cons");
        return {
          ...b,
          ...(pros !== null ? { pros: lines(pros) } : {}),
          ...(cons !== null ? { cons: lines(cons) } : {}),
        };
      }
      case "rubric":
        return {
          ...b,
          dimensions: b.dimensions.map((d) => {
            const score = get(b.id, `score:${d.key}`);
            const just = get(b.id, `just:${d.key}`);
            if (score === null && just === null) return d;
            const inl = just !== null ? parse(just) : null;
            const citations = inl?.flatMap((s) => s.marks.flatMap((m) => (m.type === "citation" ? [m.citation] : [])));
            return {
              ...d,
              ...(score !== null ? { score: Math.min(10, Math.max(1, Number(score) || d.score)) } : {}),
              ...(inl
                ? {
                    justification: inl
                      .map((s) => s.text)
                      .join("")
                      .trim(),
                    citations: citations?.length ? citations : d.citations,
                  }
                : {}),
            };
          }),
        };
      case "faq":
        return {
          ...b,
          items: b.items.map((item, i) => {
            const q = get(b.id, `q:${i}`);
            const a = get(b.id, `a:${i}`);
            return { question: q !== null ? q.trim() : item.question, answer: a !== null ? parse(a) : item.answer };
          }),
        };
      case "cta": {
        const label = get(b.id, "label");
        const note = get(b.id, "note");
        return {
          ...b,
          ...(label !== null ? { label: label.trim() || b.label } : {}),
          ...(note !== null ? { note: note.trim() || undefined } : {}),
        };
      }
      case "image": {
        const caption = get(b.id, "caption");
        return caption !== null ? { ...b, caption: caption.trim() || undefined } : b;
      }
      case "comparison_table": {
        const md = get(b.id, "rows");
        if (md === null) return b;
        const rows = lines(md).map((l) => {
          const [label, ...values] = l.split("|").map((x) => x.trim());
          return { label: label ?? "", values: b.productIds.map((_, i) => values[i] || "—") };
        });
        return { ...b, rows: rows.filter((r) => r.label) };
      }
      default:
        return b;
    }
  });
  // The overall score is always computed from the rubric (FR-CON-3).
  const rubric = next.find((b) => b.type === "rubric");
  const score = rubric?.type === "rubric" && rubric.dimensions.length ? computeOverallScore(rubric.dimensions) : null;
  const withScore = next.map((b) => (b.type === "verdict" && score !== null ? { ...b, score } : b));
  const changed = withScore.filter((b, i) => JSON.stringify(b) !== JSON.stringify(blocks[i])).map((b) => b.id);
  return { blocks: withScore, changed };
}
