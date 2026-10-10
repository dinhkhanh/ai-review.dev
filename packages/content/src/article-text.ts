import type { ArticleBody, Block, Inline } from "./blocks";

/** Splits text into sentences (good enough for English editorial prose). */
export function splitSentences(text: string): string[] {
  return (
    text
      .replace(/\s+/g, " ")
      .match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? []
  );
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

/** Visible text of one block, used for readability, word counts and originality checks. */
export function blockText(block: Block): string {
  switch (block.type) {
    case "heading":
      return block.text;
    case "verdict":
      return [block.summary, ...block.bestFor, ...block.notFor].join(" ");
    case "pros_cons":
      return [...block.pros, ...block.cons].join(". ");
    case "faq":
      return block.items.map((i) => `${i.question} ${i.answer.map((s) => s.text).join("")}`).join(" ");
    case "rubric":
      return block.dimensions.map((d) => d.justification).join(" ");
    case "cta":
      return block.label;
    default:
      return inlinesOf(block)
        .map((line) => line.map((s) => s.text).join(""))
        .join(" ");
  }
}

export function articleText(blocks: ArticleBody): string {
  return blocks.map(blockText).filter(Boolean).join("\n");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

export interface ExtractedClaim {
  id: string;
  blockId: string;
  text: string;
  sourceIds: string[];
}

/** Numbers, prices, percentages, years and limits: the claims readers rely on (FR-CON-4). */
const FACTUAL = /(\$|€|£|\d)/;

/**
 * Pulls checkable claims out of an article (FR-CON-4/5): every sentence that carries a citation,
 * plus uncited sentences containing figures (prices, limits, dates), which the fact-check flags.
 * Rubric justifications with citations are claims too.
 */
export function extractClaims(blocks: ArticleBody): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  for (const block of blocks) {
    if (block.type === "rubric") {
      for (const d of block.dimensions) {
        if (d.citations.length === 0) continue;
        claims.push({
          id: `${block.id}:${d.key}`,
          blockId: block.id,
          text: d.justification,
          sourceIds: [...new Set(d.citations.map((c) => c.sourceId))],
        });
      }
      continue;
    }
    inlinesOf(block).forEach((line, lineIndex) => {
      // Inline citation markers become ⟦id⟧ tokens so a marker stays with the sentence it follows,
      // whether it comes before or after the sentence's closing punctuation.
      const text = line
        .map((seg) => {
          const cite = seg.marks.find((m) => m.type === "citation");
          return cite ? `⟦${cite.citation.sourceId}⟧${seg.text}` : seg.text;
        })
        .join("");
      const sentences = text.split(/(?<=[.!?](?:\s*⟦[^⟧]+⟧)*)\s+(?!⟦)/);
      let n = 0;
      for (const raw of sentences) {
        const sourceIds = [...new Set([...raw.matchAll(/⟦([^⟧]+)⟧/g)].map((m) => m[1]!))];
        const sentence = raw
          .replace(/\s*⟦[^⟧]+⟧/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!sentence) continue;
        if (sourceIds.length > 0 || FACTUAL.test(sentence)) {
          claims.push({ id: `${block.id}:${lineIndex}:${n}`, blockId: block.id, text: sentence, sourceIds });
        }
        n++;
      }
    });
  }
  return claims;
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return w ? 1 : 0;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Flesch-Kincaid grade level; lower is easier. Editorial target ≈ 8–10. */
export function readingGrade(text: string): number {
  const sentences = splitSentences(text);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (sentences.length === 0 || words.length === 0) return 0;
  const syl = words.reduce((sum, w) => sum + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
  return Math.round(grade * 10) / 10;
}

/** Word n-gram shingles, used for the originality check against stored sources (FR-CON-7). */
export function shingles(text: string, n = 8): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

/** Share of the article's n-grams that appear verbatim in the sources (0..1). */
export function overlapRatio(article: string, sources: string[], n = 8): number {
  const mine = shingles(article, n);
  if (mine.size === 0) return 0;
  const theirs = new Set<string>();
  for (const s of sources) for (const g of shingles(s, n)) theirs.add(g);
  let hits = 0;
  for (const g of mine) if (theirs.has(g)) hits++;
  return hits / mine.size;
}
