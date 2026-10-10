import type { Block, Inline, QaScorecard } from "@repo/content";
import { extractSegments, segmentMarkers } from "./segments";

type Check = QaScorecard["checks"][number];

/** AI clichés in German, the counterpart of `editorial.bannedPhrases` (checked case-insensitively). */
export const GERMAN_BANNED_PHRASES = [
  "in der heutigen schnelllebigen welt",
  "in der heutigen digitalen welt",
  "gamechanger",
  "game-changer",
  "revolutioniert",
  "nahtlos",
  "tauchen wir ein",
  "eintauchen in",
  "auf das nächste level",
  "auf die nächste stufe",
  "volle potenzial",
  "volles potenzial",
  "entfesseln",
  "suchen sie nicht weiter",
  "egal ob sie",
  "hochmodern",
  "bahnbrechend",
  "robuste lösung",
  "es ist erwähnenswert",
  "am ende des tages",
  "ein muss für",
];

// --- Numbers ---

const EN_NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const DE_NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;
/** A number written as money or a share: "$12", "12 USD", "€9.50", "30%". */
const EN_PRICE =
  /(?:[$€£]\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?))|(?:(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(?:%|USD|EUR|GBP|€|\$|£))/g;

const enValue = (s: string) => Number(s.replace(/,/g, ""));
const deValue = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Numeric values in English text (1,200.50 → 1200.5). */
export function englishNumbers(text: string): number[] {
  return [...text.matchAll(EN_NUMBER)].map((m) => enValue(m[0]));
}

/** Money and percentage values in English text: these must survive translation exactly. */
export function englishPriceNumbers(text: string): number[] {
  return [...text.matchAll(EN_PRICE)].map((m) => enValue(m[1] ?? m[2]!));
}

/** Numeric values in German text, also accepting English formatting the model may have kept. */
export function targetNumbers(text: string): Set<number> {
  return new Set([
    ...[...text.matchAll(DE_NUMBER)].map((m) => deValue(m[0])),
    ...[...text.matchAll(EN_NUMBER)].map((m) => enValue(m[0])),
  ]);
}

// --- Per-block markers ---

function inlineMarkers(inlines: Inline[]) {
  const citations: string[] = [];
  const golinks: string[] = [];
  const links: string[] = [];
  for (const seg of inlines) {
    for (const m of seg.marks) {
      if (m.type === "citation") citations.push(m.citation.sourceId);
      if (m.type === "golink") golinks.push(`${m.slug}#${m.placement}`);
      if (m.type === "link") links.push(m.href);
    }
  }
  return { citations, golinks, links };
}

/** Citations, go-links and links a block carries (inline marks plus structural citations and CTAs). */
export function blockMarkers(block: Block) {
  const out = { citations: [] as string[], golinks: [] as string[], links: [] as string[] };
  const add = (inl: Inline[]) => {
    const m = inlineMarkers(inl);
    out.citations.push(...m.citations);
    out.golinks.push(...m.golinks);
    out.links.push(...m.links);
  };
  switch (block.type) {
    case "paragraph":
    case "callout":
      add(block.children);
      break;
    case "list":
      block.items.forEach(add);
      break;
    case "faq":
      block.items.forEach((i) => add(i.answer));
      break;
    case "rubric":
      block.dimensions.forEach((d) => out.citations.push(...d.citations.map((c) => c.sourceId)));
      break;
    case "pricing_table":
      block.tiers.forEach((t) => out.citations.push(...t.citations.map((c) => c.sourceId)));
      break;
    case "cta":
      out.golinks.push(`${block.goSlug}#${block.placement}`);
      break;
    default:
      break;
  }
  return out;
}

/** Items of `expected` not covered by `actual` (multiset difference). */
export function missingFrom(expected: string[], actual: string[]): string[] {
  const left = new Map<string, number>();
  for (const a of actual) left.set(a, (left.get(a) ?? 0) + 1);
  const missing: string[] = [];
  for (const e of expected) {
    const n = left.get(e) ?? 0;
    if (n > 0) left.set(e, n - 1);
    else missing.push(e);
  }
  return missing;
}

/** Visible text of a block (citation markers and link targets removed). */
export function blockText(block: Block): string {
  return extractSegments([block])
    .segments.map((s) => segmentMarkers(s.text).plainText)
    .join("\n");
}

export interface TranslationQa {
  checks: Check[];
  /** Hard checks that failed (keys). */
  failed: string[];
}

/**
 * Deterministic translation QA (no LLM). Hard: every citation, go-link/CTA and link of each source
 * block survives in the translated block with the same id, and every price or percentage is still
 * there. Soft: same block structure, other numbers, length ratio, nothing left untranslated,
 * German banned phrases. Blocks the editor removed from the translation are reported, not failed.
 */
export function translationChecks(source: Block[], target: Block[], opts: { locale?: string } = {}): TranslationQa {
  const byId = new Map(target.map((b) => [b.id, b]));
  const lostCitations: string[] = [];
  const lostGolinks: string[] = [];
  const lostLinks: string[] = [];
  const lostPrices: string[] = [];
  const lostNumbers: string[] = [];
  const untranslated: string[] = [];
  let sourceChars = 0;
  let targetChars = 0;
  for (const s of source) {
    const t = byId.get(s.id);
    if (!t) continue;
    const a = blockMarkers(s);
    const b = blockMarkers(t);
    if (missingFrom(a.citations, b.citations).length) lostCitations.push(s.id);
    lostGolinks.push(...missingFrom(a.golinks, b.golinks).map((g) => `${s.id}: ${g}`));
    lostLinks.push(...missingFrom(a.links, b.links).map((l) => `${s.id}: ${l}`));
    const sText = blockText(s);
    const tText = blockText(t);
    sourceChars += sText.length;
    targetChars += tText.length;
    const have = targetNumbers(tText);
    // Structural numbers (pricing tiers, scores) are copied, so only text numbers can drift.
    for (const n of englishPriceNumbers(sText)) if (!have.has(n)) lostPrices.push(`${s.id}: ${n}`);
    for (const n of englishNumbers(sText)) if (!have.has(n)) lostNumbers.push(`${s.id}: ${n}`);
    const sSegs = extractSegments([s]).segments;
    const tSegs = new Map(extractSegments([t]).segments.map((x) => [x.key, x.text]));
    for (const seg of sSegs) {
      const words = segmentMarkers(seg.text)
        .plainText.split(/\s+/)
        .filter((w) => /[a-z]{2,}/i.test(w));
      if (words.length >= 5 && tSegs.get(seg.key) === seg.text) untranslated.push(seg.key);
    }
  }
  const sameShape =
    source.length === target.length && source.every((b, i) => target[i]?.id === b.id && target[i]?.type === b.type);
  const missingBlocks = source.filter((b) => !byId.has(b.id)).map((b) => b.id);
  const ratio = sourceChars ? targetChars / sourceChars : 1;
  const lower = target.map(blockText).join("\n").toLowerCase();
  const banned = opts.locale === "de" ? GERMAN_BANNED_PHRASES.filter((p) => lower.includes(p)) : [];
  const show = (xs: string[]) => (xs.length ? xs.slice(0, 6).join(" | ") : undefined);

  const checks: Check[] = [
    {
      key: "translation_citations",
      label: "Translation keeps every citation",
      hard: true,
      passed: lostCitations.length === 0,
      value: lostCitations.length,
      detail: show(lostCitations),
    },
    {
      key: "translation_golinks",
      label: "Translation keeps every CTA and go-link",
      hard: true,
      passed: lostGolinks.length === 0,
      value: lostGolinks.length,
      detail: show(lostGolinks),
    },
    {
      key: "translation_links",
      label: "Translation keeps every link target",
      hard: true,
      passed: lostLinks.length === 0,
      value: lostLinks.length,
      detail: show(lostLinks),
    },
    {
      key: "translation_prices",
      label: "Translation keeps every price and percentage",
      hard: true,
      passed: lostPrices.length === 0,
      value: lostPrices.length,
      detail: show(lostPrices),
    },
    {
      key: "translation_numbers",
      label: "Translation keeps other numbers",
      hard: false,
      passed: lostNumbers.length === 0,
      value: lostNumbers.length,
      detail: show(lostNumbers),
    },
    {
      key: "translation_structure",
      label: "Same block structure as the English version",
      hard: false,
      passed: sameShape,
      value: `${target.length}/${source.length}`,
      detail: missingBlocks.length ? `missing: ${missingBlocks.slice(0, 8).join(", ")}` : undefined,
    },
    {
      key: "translation_length",
      label: "Length within 80–170% of the English text",
      hard: false,
      passed: ratio >= 0.8 && ratio <= 1.7,
      value: Math.round(ratio * 100),
    },
    {
      key: "translation_complete",
      label: "Nothing left untranslated",
      hard: false,
      passed: untranslated.length === 0,
      value: untranslated.length,
      detail: show(untranslated),
    },
    ...(opts.locale === "de"
      ? [
          {
            key: "banned_phrases_de",
            label: "No banned phrases (German)",
            hard: false,
            passed: banned.length === 0,
            value: banned.length,
            detail: banned.join(", ") || undefined,
          },
        ]
      : []),
  ];
  return { checks, failed: checks.filter((c) => c.hard && !c.passed).map((c) => c.key) };
}

/** English-only scorecard checks that do not apply to translations (they are replaced above). */
export const ENGLISH_ONLY_CHECKS = ["readability", "banned_phrases"];
