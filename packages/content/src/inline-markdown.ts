import type { Inline, InlineMark } from "./blocks";

/**
 * A small, lossless text syntax for inline content, used by the CMS editor and by LLM prompts
 * (the model writes it; we parse it into blocks). Never rendered as Markdown/HTML directly.
 *
 *   **bold**   *italic*   `code`   [text](https://url)   [text](go:slug#placement)   [^S3]
 *
 * `[^REF]` is a citation; REF is mapped to a source id by the caller (e.g. "S3" -> uuid).
 * Backslash escapes the next character (`\*`, `\[`, `\\`).
 */

export interface ParseOptions {
  /** Maps a citation ref to a source id; return null to drop an unknown ref. */
  resolveCitation?: (ref: string) => string | null;
}

export interface SerializeOptions {
  /** Maps a source id to the ref written in text. Defaults to the id itself. */
  citationRef?: (sourceId: string) => string;
}

type Style = "bold" | "italic" | "code";

const ESCAPABLE = /[\\*`[\]]/g;

function escapeText(text: string): string {
  return text.replace(ESCAPABLE, (c) => `\\${c}`);
}

function sameMarks(a: InlineMark[], b: InlineMark[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Merges adjacent segments with identical marks and drops empty unmarked text. */
export function normalizeInlines(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const seg of inlines) {
    const isCitation = seg.marks.some((m) => m.type === "citation");
    if (!seg.text && !isCitation) continue;
    const prev = out[out.length - 1];
    if (prev && !isCitation && !prev.marks.some((m) => m.type === "citation") && sameMarks(prev.marks, seg.marks)) {
      prev.text += seg.text;
    } else {
      out.push({ text: seg.text, marks: [...seg.marks] });
    }
  }
  return out;
}

function parseLinkTarget(target: string): InlineMark | null {
  const go = /^go:([a-z0-9][a-z0-9-]*)(?:#([a-z0-9_-]+))?$/i.exec(target);
  if (go) return { type: "golink", slug: go[1]!.toLowerCase(), placement: (go[2] ?? "inline").toLowerCase() };
  try {
    const url = new URL(target);
    if (url.protocol === "https:" || url.protocol === "http:") return { type: "link", href: url.toString() };
  } catch {
    // fall through
  }
  return null;
}

/** Finds the matching `]` for a `[` at `start`, honouring escapes. */
function findClosingBracket(src: string, start: number): number {
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "]") return i;
  }
  return -1;
}

function unescape(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

export function parseInline(src: string, opts: ParseOptions = {}): Inline[] {
  const out: Inline[] = [];
  const styles: Style[] = [];
  let buf = "";
  const marks = (): InlineMark[] => styles.map((type) => ({ type }));
  const flush = () => {
    if (buf) out.push({ text: buf, marks: marks() });
    buf = "";
  };
  const toggle = (style: Style) => {
    flush();
    const at = styles.lastIndexOf(style);
    if (at >= 0) styles.splice(at, 1);
    else styles.push(style);
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === "\\" && i + 1 < src.length) {
      buf += src[++i];
      continue;
    }
    if (styles.includes("code") && ch !== "`") {
      buf += ch;
      continue;
    }
    if (ch === "`") {
      // Only open code if it closes later; otherwise it is a literal backtick.
      if (!styles.includes("code") && src.indexOf("`", i + 1) < 0) {
        buf += ch;
        continue;
      }
      toggle("code");
      continue;
    }
    if (ch === "*" && src[i + 1] === "*") {
      if (!styles.includes("bold") && src.indexOf("**", i + 2) < 0) {
        buf += "**";
        i++;
        continue;
      }
      toggle("bold");
      i++;
      continue;
    }
    if (ch === "*") {
      const closes = /\*(?!\*)/.test(src.slice(i + 1).replace(/\*\*/g, ""));
      if (!styles.includes("italic") && (!closes || /\s/.test(src[i + 1] ?? " "))) {
        buf += ch;
        continue;
      }
      toggle("italic");
      continue;
    }
    if (ch === "[") {
      const close = findClosingBracket(src, i);
      if (close > i) {
        const inner = src.slice(i + 1, close);
        if (inner.startsWith("^")) {
          const ref = inner.slice(1).trim();
          const sourceId = opts.resolveCitation ? opts.resolveCitation(ref) : ref;
          flush();
          if (sourceId) out.push({ text: "", marks: [{ type: "citation", citation: { sourceId } }] });
          i = close;
          continue;
        }
        if (src[close + 1] === "(") {
          const end = src.indexOf(")", close + 2);
          const mark = end > close ? parseLinkTarget(src.slice(close + 2, end).trim()) : null;
          if (mark) {
            flush();
            out.push({ text: unescape(inner), marks: [...marks(), mark] });
            i = end;
            continue;
          }
        }
      }
    }
    buf += ch;
  }
  flush();
  return normalizeInlines(out);
}

export function serializeInline(inlines: Inline[], opts: SerializeOptions = {}): string {
  let out = "";
  for (const seg of inlines) {
    const citation = seg.marks.find((m) => m.type === "citation");
    if (citation) {
      if (seg.text) out += escapeText(seg.text);
      out += `[^${opts.citationRef ? opts.citationRef(citation.citation.sourceId) : citation.citation.sourceId}]`;
      continue;
    }
    let text = seg.marks.some((m) => m.type === "code") ? seg.text.replace(/`/g, "\\`") : escapeText(seg.text);
    const link = seg.marks.find((m) => m.type === "link" || m.type === "golink");
    if (link?.type === "link") text = `[${text}](${link.href})`;
    if (link?.type === "golink") text = `[${text}](go:${link.slug}#${link.placement})`;
    if (seg.marks.some((m) => m.type === "code")) text = `\`${text}\``;
    if (seg.marks.some((m) => m.type === "italic")) text = `*${text}*`;
    if (seg.marks.some((m) => m.type === "bold")) text = `**${text}**`;
    out += text;
  }
  return out;
}

/** Plain text of inline content (citations dropped). */
export function inlineText(inlines: Inline[]): string {
  return inlines.map((s) => s.text).join("");
}
