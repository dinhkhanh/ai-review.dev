import {
  articleText,
  readingGrade,
  wordCount,
  type ArticleBody,
  type Block,
  type CheckedClaim,
  type FactSheet,
} from "@repo/content";
import { pricingCitationCoverage } from "@repo/core";
import { findBannedPhrases } from "../src/qa";
import type { GoldenExpect } from "./golden";

/** Pure graders for the eval suites. Each returns named checks plus numeric metrics. */
export interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface Graded {
  checks: Check[];
  metrics: Record<string, number | null>;
}

export const shareOf = (checks: Check[]) =>
  checks.length === 0 ? 1 : checks.filter((c) => c.passed).length / checks.length;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const sameTier = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
};
const round = (n: number) => Math.round(n * 1000) / 1000;

/** fact_sheet suite: field accuracy against the golden expectations, with tolerances. */
export function scoreFactSheet(expect: GoldenExpect, sheet: FactSheet | null): Graded {
  if (!sheet) return { checks: [{ name: "fact_sheet_saved", passed: false }], metrics: {} };
  const tiers = sheet.pricing?.tiers.value ?? [];
  const checks: Check[] = [];

  const tierChecks = expect.tiers.map((name) => ({
    name: `tier:${name}`,
    passed: tiers.some((t) => sameTier(t.name, name)),
  }));
  const priceChecks = expect.prices.map((p) => {
    const pool = p.tier ? tiers.filter((t) => sameTier(t.name, p.tier!)) : tiers;
    const hit = pool.find(
      (t) => t.price !== null && Math.abs(t.price - p.price) <= p.tolerance && t.period === p.period,
    );
    const seen = pool.map((t) => `${t.name}=${t.price ?? "null"}/${t.period}`).join(", ");
    return {
      name: `price:${p.tier ?? "any"}=${p.price}/${p.period}`,
      passed: !!hit,
      ...(hit ? {} : { detail: seen || "no matching tier" }),
    };
  });
  checks.push(...tierChecks, ...priceChecks);

  if (expect.freePlan !== null) {
    const got = sheet.pricing?.freePlan?.value;
    checks.push({
      name: `free_plan=${expect.freePlan}`,
      passed: got === expect.freePlan,
      detail: `got ${got ?? "missing"}`,
    });
  }
  if (expect.trialDays !== null) {
    const got = sheet.pricing?.freeTrialDays?.value;
    checks.push({
      name: `trial_days=${expect.trialDays}`,
      passed: got === expect.trialDays,
      detail: `got ${got ?? "missing"}`,
    });
  }
  const features = sheet.features.map((f) => f.value.toLowerCase());
  const featureChecks = expect.features.map((kw) => ({
    name: `feature:${kw}`,
    passed: features.some((f) => f.includes(kw.toLowerCase())),
  }));
  checks.push(...featureChecks);
  const coverage = pricingCitationCoverage(sheet);
  if (tiers.length)
    checks.push({ name: "pricing_citations>=90%", passed: coverage >= 0.9, detail: `${round(coverage)}` });

  return {
    checks,
    metrics: {
      tierRecall: tierChecks.length ? round(shareOf(tierChecks)) : null,
      priceAccuracy: priceChecks.length ? round(shareOf(priceChecks)) : null,
      featureRecall: featureChecks.length ? round(shareOf(featureChecks)) : null,
      pricingCitationCoverage: round(coverage),
      features: sheet.features.length,
      tiers: tiers.length,
    },
  };
}

function citationIds(blocks: ArticleBody): string[] {
  const ids: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.sourceId === "string") ids.push(obj.sourceId);
      Object.values(obj).forEach(visit);
    }
  };
  visit(blocks);
  return ids;
}

const has = (blocks: ArticleBody, type: Block["type"]) => blocks.some((b) => b.type === type);

/**
 * write suite, deterministic part: the review contract (FR-CON-2/3), citations that resolve to
 * real sources, house style (banned phrases, length) and a sane computed score.
 */
export function gradeArticle(
  blocks: ArticleBody,
  ctx: {
    overallScore: number | null;
    expect: GoldenExpect;
    sourceIds: Set<string>;
    rubricKeys: string[];
    bannedPhrases: string[];
    minWords: number;
  },
): Graded {
  const text = articleText(blocks);
  const words = wordCount(text);
  const cites = citationIds(blocks);
  const dangling = cites.filter((id) => !ctx.sourceIds.has(id));
  const rubric = blocks.find((b) => b.type === "rubric");
  const dims = rubric?.type === "rubric" ? rubric.dimensions.map((d) => d.key) : [];
  const h2 = blocks.filter((b) => b.type === "heading" && b.level === 2).length;
  const ctas = blocks.filter((b) => b.type === "cta").length;
  const banned = findBannedPhrases(text, ctx.bannedPhrases);
  const [lo, hi] = ctx.expect.rubricOverall;
  const score = ctx.overallScore;
  const checks: Check[] = [
    { name: "verdict", passed: has(blocks, "verdict") },
    {
      name: "rubric_dimensions",
      passed: ctx.rubricKeys.every((k) => dims.includes(k)),
      detail: `${dims.length}/${ctx.rubricKeys.length}`,
    },
    { name: `overall_in_[${lo},${hi}]`, passed: score !== null && score >= lo && score <= hi, detail: `${score}` },
    { name: "pricing_table", passed: has(blocks, "pricing_table") },
    { name: "pros_cons", passed: has(blocks, "pros_cons") },
    { name: "faq", passed: has(blocks, "faq") },
    { name: "sources_block", passed: has(blocks, "sources") },
    { name: "ctas>=3", passed: ctas >= 3, detail: `${ctas}` },
    { name: "h2>=6", passed: h2 >= 6, detail: `${h2}` },
    { name: `words>=${ctx.minWords}`, passed: words >= ctx.minWords, detail: `${words}` },
    { name: "citations>=10", passed: cites.length >= 10, detail: `${cites.length}` },
    {
      name: "citations_resolve",
      passed: dangling.length === 0,
      detail: dangling.length ? `${dangling.length} dangling` : undefined,
    },
    { name: "no_banned_phrases", passed: banned.length === 0, detail: banned.join(", ") || undefined },
  ];
  return {
    checks,
    metrics: { words, citations: cites.length, h2, readingGrade: readingGrade(text), overallScore: score },
  };
}

export interface SeededError {
  blockId: string;
  from: string;
  to: string;
  /** The mutated line, for the report. */
  text: string;
}

const NUMBER = /\$?\d+(?:[.,]\d+)?/;

/** A clearly wrong replacement: years shift by three, other numbers roughly double. */
export function perturbNumber(token: string): string {
  const dollar = token.startsWith("$") ? "$" : "";
  const raw = token.replace("$", "").replace(",", "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return token;
  if (!dollar && Number.isInteger(n) && n >= 1900 && n <= 2100) return String(n - 3);
  if (Number.isInteger(n)) return `${dollar}${n * 2 + 5}`;
  return `${dollar}${(Math.round(n * 2.5 * 100) / 100).toFixed(2)}`;
}

/**
 * fact_check suite: injects `count` wrong figures into cited sentences, spread across the article.
 * Only paragraph and list lines that carry a citation are touched, so the fact-checker has the
 * cited source to compare against (the realistic failure: a mis-copied number with a citation).
 */
export function seedErrors(blocks: ArticleBody, count: number): { blocks: ArticleBody; seeded: SeededError[] } {
  type Candidate = { blockIndex: number; lineIndex: number; segIndex: number };
  const linesOf = (b: Block) => (b.type === "paragraph" ? [b.children] : b.type === "list" ? b.items : []);
  const candidates: Candidate[] = [];
  blocks.forEach((b, blockIndex) => {
    linesOf(b).forEach((line, lineIndex) => {
      if (!line.some((seg) => seg.marks.some((m) => m.type === "citation"))) return;
      const segIndex = line.findIndex((seg) => NUMBER.test(seg.text));
      if (segIndex > -1) candidates.push({ blockIndex, lineIndex, segIndex });
    });
  });
  // One per block, spread evenly through the article.
  const perBlock = [...new Map(candidates.map((c) => [c.blockIndex, c])).values()];
  const picks =
    perBlock.length <= count
      ? perBlock
      : Array.from({ length: count }, (_, i) => perBlock[Math.floor((i * perBlock.length) / count)]!);

  const out: ArticleBody = structuredClone(blocks);
  const seeded: SeededError[] = [];
  for (const pick of picks) {
    const block = out[pick.blockIndex]!;
    const line = linesOf(block)[pick.lineIndex]!;
    const seg = line[pick.segIndex]!;
    const from = NUMBER.exec(seg.text)![0];
    const to = perturbNumber(from);
    if (to === from) continue;
    seg.text = seg.text.replace(from, to);
    seeded.push({ blockId: block.id, from, to, text: line.map((s) => s.text).join("") });
  }
  return { blocks: out, seeded };
}

/** Which extracted claims carry a seeded error (same block, contains the replacement figure). */
export function seededClaimIds(claims: Array<{ id: string; blockId: string; text: string }>, seeded: SeededError[]) {
  return new Set(
    claims
      .filter((c) => seeded.some((s) => s.blockId === c.blockId && c.text.includes(s.to.replace("$", ""))))
      .map((c) => c.id),
  );
}

/**
 * Recall = seeded claims flagged (not "supported") / seeded claims. Precision = seeded flagged /
 * all flagged among the checked claims. Control claims flagged may be genuine problems in the
 * source article, so precision is a lower bound.
 */
export function scoreFactCheck(checked: CheckedClaim[], seeded: Set<string>): Graded {
  const flagged = checked.filter((c) => c.verdict !== "supported");
  const truePos = flagged.filter((c) => seeded.has(c.id)).length;
  const recall = seeded.size ? truePos / seeded.size : null;
  const precision = flagged.length ? truePos / flagged.length : null;
  const missed = checked.filter((c) => seeded.has(c.id) && c.verdict === "supported");
  return {
    checks: [
      {
        name: "recall>=0.8",
        passed: recall !== null && recall >= 0.8,
        detail: `${recall === null ? "n/a" : round(recall)}`,
      },
      {
        name: "precision>=0.6",
        passed: precision !== null && precision >= 0.6,
        detail: `${precision === null ? "n/a" : round(precision)}`,
      },
      ...missed.map((c) => ({ name: `missed:${c.id}`, passed: false, detail: c.text.slice(0, 160) })),
    ],
    metrics: {
      recall: recall === null ? null : round(recall),
      precision: precision === null ? null : round(precision),
      seeded: seeded.size,
      checked: checked.length,
      flagged: flagged.length,
      controlFlagged: flagged.length - truePos,
    },
  };
}
