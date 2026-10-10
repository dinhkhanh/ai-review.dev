import { parseInline, serializeInline, type Block, type Citation } from "@repo/content";

/**
 * Line-based view of prose blocks for edit passes (fact-fix, style, CMS editing): each block becomes
 * a list of inline-syntax strings with S-ref citations, and can be rebuilt from edited lines.
 */
export type EditableBlock = Extract<Block, { type: "paragraph" | "list" | "callout" | "faq" | "rubric" }>;

export function isEditable(block: Block): block is EditableBlock {
  return ["paragraph", "list", "callout", "faq", "rubric"].includes(block.type);
}

export interface RefMap {
  ref: (sourceId: string) => string;
  id: (ref: string) => string | null;
}

const markers = (citations: Citation[], refs: RefMap) => citations.map((c) => `[^${refs.ref(c.sourceId)}]`).join("");

export function blockToLines(block: EditableBlock, refs: RefMap): string[] {
  const ser = (inl: Parameters<typeof serializeInline>[0]) => serializeInline(inl, { citationRef: refs.ref });
  switch (block.type) {
    case "paragraph":
    case "callout":
      return [ser(block.children)];
    case "list":
      return block.items.map(ser);
    case "faq":
      return block.items.map((i) => ser(i.answer));
    case "rubric":
      return block.dimensions.map((d) => `${d.justification}${markers(d.citations, refs)}`);
  }
}

/**
 * Applies edited lines to a block. Returns null when the shape does not match (wrong line count
 * for fixed-shape blocks), so callers keep the original.
 */
export function applyLines(block: EditableBlock, lines: string[], refs: RefMap): EditableBlock | null {
  const parse = (s: string) => parseInline(s, { resolveCitation: refs.id });
  switch (block.type) {
    case "paragraph":
    case "callout":
      return lines.length >= 1 ? { ...block, children: parse(lines.join(" ")) } : null;
    case "list":
      return lines.length >= 1 ? { ...block, items: lines.filter((l) => l.trim()).map(parse) } : null;
    case "faq":
      if (lines.length !== block.items.length) return null;
      return { ...block, items: block.items.map((item, i) => ({ ...item, answer: parse(lines[i]!) })) };
    case "rubric": {
      if (lines.length !== block.dimensions.length) return null;
      return {
        ...block,
        dimensions: block.dimensions.map((d, i) => {
          const inl = parse(lines[i]!);
          const citations = inl.flatMap((s) => s.marks.flatMap((m) => (m.type === "citation" ? [m.citation] : [])));
          return {
            ...d,
            justification: inl
              .map((s) => s.text)
              .join("")
              .trim(),
            citations: citations.length ? [...new Map(citations.map((c) => [c.sourceId, c])).values()] : d.citations,
          };
        }),
      };
    }
  }
}

/** Citation refs in a line, as a sorted multiset string, to verify edits did not drop sources. */
export function citationSignature(line: string): string {
  return [...line.matchAll(/\[\^([A-Za-z0-9-]+)\]/g)]
    .map((m) => m[1]!.toUpperCase())
    .sort()
    .join(",");
}
