import type { QaScorecard } from "@repo/content";
import { describe, expect, it } from "vitest";
import { autoPublishVerdict, planRefresh, probeSite, sectionForPath, softScore } from "./index";
import { fitPost } from "./steps/social";
import { nextPublishSlot } from "./steps/publish-decision";

const card = (hard: boolean, soft: boolean[]): QaScorecard => ({
  hardGatesPassed: hard,
  computedAt: new Date().toISOString(),
  checks: [
    { key: "h", label: "h", hard: true, passed: hard },
    ...soft.map((passed, i) => ({ key: `s${i}`, label: `s${i}`, hard: false, passed })),
  ],
});

describe("refresh planning (FR-MNT-1)", () => {
  it("maps fact-sheet paths to sections and ignores rating drift", () => {
    expect(sectionForPath("pricing.tiers[1].price")).toBe("pricing");
    expect(sectionForPath("integrations")).toBe("features");
    expect(sectionForPath("security")).toBe("security");
    expect(sectionForPath("ratings[0].count")).toBeNull();
    const plan = planRefresh([
      { path: "ratings[0].count", before: 300, after: 312 },
      { path: "pricing.tiers[1].price", before: 12, after: 15 },
      { path: "features", before: ["a"], after: ["a", "b"] },
    ]);
    expect(plan).toMatchObject({ material: true, pricingChanged: true, sections: ["features", "pricing"] });
    expect(plan.changes).toHaveLength(2);
    expect(planRefresh([{ path: "ratings[0].rating", before: 4.5, after: 4.6 }]).material).toBe(false);
  });
});

describe("auto-publish rules (FR-QA-4)", () => {
  const base = {
    requireHumanReview: false,
    autoCategories: ["hosting"],
    articleCategories: ["hosting"],
    scorecard: card(true, [true, true, true, false]),
    minSoftScore: 0.7,
  };
  it("publishes only when every condition holds", () => {
    expect(softScore(base.scorecard)).toBe(0.75);
    expect(autoPublishVerdict(base)).toEqual({ eligible: true });
    expect(autoPublishVerdict({ ...base, requireHumanReview: true }).eligible).toBe(false);
    expect(autoPublishVerdict({ ...base, articleCategories: ["hosting", "marketing"] })).toMatchObject({
      eligible: false,
      reason: "auto-publish is off for marketing",
    });
    expect(autoPublishVerdict({ ...base, articleCategories: [] }).eligible).toBe(false);
    expect(autoPublishVerdict({ ...base, scorecard: card(false, [true]) }).eligible).toBe(false);
    expect(autoPublishVerdict({ ...base, minSoftScore: 0.8 }).eligible).toBe(false);
  });
  it("schedules capped articles for 09:00 UTC the next day", () => {
    expect(nextPublishSlot(new Date("2026-10-10T23:30:00Z")).toISOString()).toBe("2026-10-11T09:00:00.000Z");
  });
});

describe("social posts (FR-CON-8)", () => {
  it("fits the limit and ends with the link exactly once", () => {
    const url = "https://ai-review.dev/reviews/acme-review";
    const post = fitPost(`${"word ".repeat(100)}${url}`, url, 280);
    expect(post.length).toBeLessThanOrEqual(280);
    expect(post.endsWith(url)).toBe(true);
    expect(post.split(url)).toHaveLength(2);
  });
});

describe("site check (FR-MNT-4)", () => {
  const respond = (status: number, url = "") =>
    (async () => {
      const res = new Response("x", { status });
      if (url) Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof fetch;
  it("classifies dead, moved, blocked and healthy sites", async () => {
    expect((await probeSite("https://acme.dev", "acme.dev", respond(410))).status).toBe("down");
    expect((await probeSite("https://acme.dev", "acme.dev", respond(403))).status).toBe("ok");
    expect((await probeSite("https://acme.dev", "acme.dev", respond(200, "https://buyer.com/acme"))).status).toBe(
      "moved",
    );
    expect((await probeSite("https://acme.dev", "acme.dev", respond(200, "https://www.acme.dev/"))).status).toBe("ok");
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await probeSite("https://acme.dev", "acme.dev", failing)).status).toBe("down");
  });
});
