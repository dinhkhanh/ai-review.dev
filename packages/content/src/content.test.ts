import { describe, expect, it } from "vitest";
import { articleBodySchema, computeOverallScore, DEFAULT_RUBRIC, slugify } from "./index";

describe("slugify", () => {
  it("normalises accents, symbols and spacing", () => {
    expect(slugify("  Notion AI — Café & Docs!  ")).toBe("notion-ai-cafe-and-docs");
  });
  it("caps length without a trailing hyphen", () => {
    const slug = slugify("a".repeat(79) + " b");
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("computeOverallScore", () => {
  it("default rubric weights sum to 1", () => {
    expect(DEFAULT_RUBRIC.reduce((s, d) => s + d.weight, 0)).toBeCloseTo(1);
  });
  it("computes a weighted mean rounded to one decimal", () => {
    expect(
      computeOverallScore([
        { weight: 0.5, score: 8 },
        { weight: 0.5, score: 7 },
      ]),
    ).toBe(7.5);
    expect(
      computeOverallScore([
        { weight: 0.25, score: 9 },
        { weight: 0.75, score: 6 },
      ]),
    ).toBe(6.8);
  });
  it("rejects zero total weight", () => {
    expect(() => computeOverallScore([{ weight: 0, score: 5 }])).toThrow();
  });
});

describe("articleBodySchema", () => {
  it("accepts a minimal review body and rejects HTML-ish unknown blocks", () => {
    const ok = articleBodySchema.safeParse([
      { id: "h1", type: "heading", level: 2, text: "Verdict" },
      { id: "v1", type: "verdict", score: 8.2, summary: "Great for small teams." },
      { id: "c1", type: "cta", goSlug: "notion", placement: "verdict", label: "Try Notion" },
    ]);
    expect(ok.success).toBe(true);
    expect(articleBodySchema.safeParse([{ id: "x", type: "html", html: "<p>no</p>" }]).success).toBe(false);
  });
});
