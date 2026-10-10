/** ~800 tokens per chunk with ~100 tokens overlap (docs/plan.md §5), at ~4 characters per token. */
const TARGET = 3200;
const OVERLAP = 400;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Splits markdown into overlapping chunks on paragraph boundaries; paragraphs longer than a chunk
 * are split on sentences, then hard-wrapped.
 */
export function chunkMarkdown(markdown: string, target = TARGET, overlap = OVERLAP): string[] {
  const clean = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // keep link text only
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];
  const pieces: string[] = [];
  for (const para of clean.split(/\n\s*\n/)) {
    if (para.length <= target) pieces.push(para);
    else {
      let buf = "";
      for (const sentence of para.split(/(?<=[.!?])\s+/)) {
        if ((buf + " " + sentence).length > target && buf) {
          pieces.push(buf);
          buf = "";
        }
        if (sentence.length > target) {
          for (let i = 0; i < sentence.length; i += target) pieces.push(sentence.slice(i, i + target));
        } else buf = buf ? `${buf} ${sentence}` : sentence;
      }
      if (buf) pieces.push(buf);
    }
  }
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > target) {
      chunks.push(current);
      const tail = current.slice(-overlap);
      const cut = tail.indexOf(" ");
      current = cut >= 0 ? tail.slice(cut + 1) : tail;
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/** Trims long page text for prompts, keeping the start (where pricing/features usually are). */
export function clip(text: string | null | undefined, maxChars: number): string {
  if (!text) return "";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n[…truncated]`;
}
