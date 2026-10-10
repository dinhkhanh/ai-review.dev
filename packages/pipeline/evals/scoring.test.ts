import type { ArticleBody, CheckedClaim, FactSheet } from "@repo/content";
import { describe, expect, it } from "vitest";
import { loadGoldenSet, type GoldenExpect } from "./golden";
import { formatTable, parseArgs } from "./run";
import { gradeArticle, perturbNumber, scoreFactCheck, scoreFactSheet, seedErrors, seededClaimIds } from "./scoring";

const S1 = "11111111-1111-4111-8111-111111111111";
const cite = { sourceId: S1 };

const expectBase: GoldenExpect = {
  source: { url: "https://acme.dev/pricing", checkedAt: "2026-10-10", note: "test" },
  tiers: ["Starter", "Pro"],
  prices: [
    { tier: "Starter", price: 9, period: "month", tolerance: 0 },
    { tier: null, price: 20, period: "month", tolerance: 1 },
  ],
  freePlan: false,
  trialDays: 14,
  features: ["goal", "api"],
  rubricOverall: [6, 9],
};

const sheet = (over: Partial<FactSheet> = {}): FactSheet => ({
  name: "Acme",
  website: "https://acme.dev",
  pricing: {
    tiers: {
      value: [
        { name: "Starter plan", price: 9, currency: "USD", period: "month", limits: [], highlights: [] },
        { name: "Pro", price: 21, currency: "USD", period: "month", limits: [], highlights: [] },
      ],
      citations: [cite],
      confidence: "high",
    },
    freePlan: { value: false, citations: [cite], confidence: "high" },
    freeTrialDays: { value: 14, citations: [cite], confidence: "high" },
  },
  features: [
    { value: "Custom goals", citations: [cite], confidence: "high" },
    { value: "Stats API", citations: [cite], confidence: "high" },
  ],
  ratings: [],
  limitations: [],
  ...over,
});

describe("golden set", () => {
  it("loads and has 10–20 cases with sources", () => {
    const cases = loadGoldenSet();
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases.length).toBeLessThanOrEqual(20);
    for (const c of cases) expect(c.expect.source.url).toMatch(/^https:\/\//);
  });
});

describe("scoreFactSheet", () => {
  it("passes when tiers, prices (with tolerance), plan facts and features match", () => {
    const graded = scoreFactSheet(expectBase, sheet());
    expect(graded.checks.filter((c) => !c.passed)).toEqual([]);
    expect(graded.metrics).toMatchObject({ tierRecall: 1, priceAccuracy: 1, featureRecall: 1 });
  });

  it("fails wrong prices, missing trial and missing features with details", () => {
    const s = sheet();
    s.pricing!.tiers.value[0]!.price = 12;
    delete s.pricing!.freeTrialDays;
    s.features = [];
    const graded = scoreFactSheet(expectBase, s);
    const failed = graded.checks.filter((c) => !c.passed).map((c) => c.name);
    expect(failed).toEqual(["price:Starter=9/month", "trial_days=14", "feature:goal", "feature:api"]);
    expect(graded.checks.find((c) => c.name === "trial_days=14")?.detail).toBe("got missing");
  });

  it("skips unstated plan facts and handles a missing sheet", () => {
    const graded = scoreFactSheet({ ...expectBase, freePlan: null, trialDays: null }, sheet());
    expect(graded.checks.some((c) => c.name.startsWith("free_plan"))).toBe(false);
    expect(scoreFactSheet(expectBase, null).checks[0]).toEqual({ name: "fact_sheet_saved", passed: false });
  });
});

const article: ArticleBody = [
  { id: "verdict", type: "verdict", score: 7.5, summary: "Good.", bestFor: [], notFor: [] },
  { id: "cta-verdict", type: "cta", goSlug: "acme", placement: "verdict", label: "Visit" },
  {
    id: "p1",
    type: "paragraph",
    children: [
      { text: "Starter costs $9 per month.", marks: [{ type: "citation", citation: cite }] },
      { text: " Teams love it.", marks: [] },
    ],
  },
  {
    id: "p2",
    type: "paragraph",
    children: [{ text: "The trial lasts 14 days.", marks: [{ type: "citation", citation: cite }] }],
  },
  { id: "p3", type: "paragraph", children: [{ text: "No numbers here.", marks: [] }] },
];

describe("seedErrors", () => {
  it("perturbs figures clearly", () => {
    expect(perturbNumber("$9")).toBe("$23");
    expect(perturbNumber("14")).toBe("33");
    expect(perturbNumber("2019")).toBe("2016");
    expect(perturbNumber("7.50")).toBe("18.75");
  });

  it("mutates one cited figure per block without touching the input", () => {
    const { blocks, seeded } = seedErrors(article, 5);
    expect(seeded.map((s) => [s.blockId, s.from, s.to])).toEqual([
      ["p1", "$9", "$23"],
      ["p2", "14", "33"],
    ]);
    expect(JSON.stringify(blocks)).toContain("$23 per month");
    expect(JSON.stringify(article)).not.toContain("$23");
    const ids = seededClaimIds(
      [
        { id: "p1:0:0", blockId: "p1", text: "Starter costs $23 per month." },
        { id: "p1:0:1", blockId: "p1", text: "Teams love it." },
        { id: "p2:0:0", blockId: "p2", text: "The trial lasts 33 days." },
      ],
      seeded,
    );
    expect([...ids]).toEqual(["p1:0:0", "p2:0:0"]);
  });

  it("spreads picks when there are more candidates than requested", () => {
    expect(seedErrors(article, 1).seeded).toHaveLength(1);
  });
});

describe("scoreFactCheck", () => {
  const claim = (id: string, verdict: CheckedClaim["verdict"]): CheckedClaim => ({
    id,
    blockId: id,
    text: id,
    sourceIds: [S1],
    verdict,
    note: null,
    fixed: false,
  });

  it("computes recall and precision over flagged claims", () => {
    const graded = scoreFactCheck(
      [claim("a", "unsupported"), claim("b", "supported"), claim("c", "outdated"), claim("d", "supported")],
      new Set(["a", "b"]),
    );
    expect(graded.metrics).toMatchObject({ recall: 0.5, precision: 0.5, flagged: 2, controlFlagged: 1 });
    expect(graded.checks.map((c) => c.name)).toEqual(["recall>=0.8", "precision>=0.6", "missed:b"]);
  });
});

describe("gradeArticle", () => {
  it("reports structure, citations and score band", () => {
    const graded = gradeArticle(article, {
      overallScore: 7.5,
      expect: expectBase,
      sourceIds: new Set([S1]),
      rubricKeys: ["features"],
      bannedPhrases: ["love it"],
      minWords: 10,
    });
    const byName = Object.fromEntries(graded.checks.map((c) => [c.name, c.passed]));
    expect(byName).toMatchObject({
      verdict: true,
      "overall_in_[6,9]": true,
      citations_resolve: true,
      rubric_dimensions: false,
      no_banned_phrases: false,
      "ctas>=3": false,
    });
    const orphan = gradeArticle(article, {
      overallScore: null,
      expect: expectBase,
      sourceIds: new Set(),
      rubricKeys: [],
      bannedPhrases: [],
      minWords: 0,
    });
    expect(orphan.checks.find((c) => c.name === "citations_resolve")?.detail).toBe("2 dangling");
    expect(orphan.checks.find((c) => c.name === "overall_in_[6,9]")?.passed).toBe(false);
  });
});

describe("runner", () => {
  it("parses arguments, ignoring pnpm's --", () => {
    expect(parseArgs(["--", "--suite", "write", "--cases", "a,b", "--compare", "both", "--no-judge"])).toEqual({
      suite: "write",
      cases: ["a", "b"],
      compare: "both",
      noJudge: true,
      errors: 6,
      dry: false,
    });
    expect(() => parseArgs(["--suite", "nope"])).toThrow(/--suite/);
    expect(() => parseArgs(["--suite", "write", "--compare", "x"])).toThrow(/--compare/);
  });

  it("formats a summary table", () => {
    const table = formatTable([
      {
        case: "acme",
        status: "failed",
        score: 0.5,
        checks: [{ name: "x", passed: false, detail: "y" }],
        metrics: { recall: 1 },
      },
    ]);
    expect(table).toContain("acme");
    expect(table).toContain("50%");
    expect(table).toContain("x (y)");
  });
});
