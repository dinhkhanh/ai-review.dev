import type { GenerateOptions, Llm } from "@repo/ai";
import { getActivePromptOverride, latestFactSheet, latestStepRuns, listSources, savePromptVersion } from "@repo/core";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { GoldenCase } from "./golden";
import { applyPromptSource, costMeter, evalBaseUrl, evalServices, promptVersions, seedSnapshot } from "./harness";
import type { Snapshot } from "./snapshot-schema";
import { runFactCheckCase, runFactSheetCase } from "./suites";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const SRC = "22222222-2222-4222-8222-222222222222";
const SRC2 = "33333333-3333-4333-8333-333333333333";
const now = "2026-10-10T00:00:00.000Z";
const pricingText = "Acme pricing. Starter costs $9 per month. Pro costs $20 per month. 14-day free trial. ".repeat(4);

const snap: Snapshot = {
  version: 1,
  exportedAt: now,
  product: {
    name: "Acme",
    slug: "acme",
    websiteUrl: "https://acme.dev",
    domain: "acme.dev",
    tagline: "Tracker",
    categorySlug: "developer-tools",
    profile: null,
  },
  sources: [
    {
      id: SRC,
      url: "https://acme.dev/pricing",
      kind: "official",
      title: "Pricing",
      fetchedAt: now,
      createdAt: now,
      contentMd: pricingText,
    },
    {
      id: SRC2,
      url: "https://acme.dev",
      kind: "official",
      title: "Home",
      fetchedAt: now,
      createdAt: "2026-10-10T00:00:01.000Z",
      contentMd: "Acme tracks issues and goals. ".repeat(10),
    },
  ],
  chunks: [
    { sourceId: SRC, ord: 0, text: pricingText, tokenCount: 60 },
    { sourceId: SRC2, ord: 0, text: "Acme tracks issues and goals.", tokenCount: 8 },
  ],
  factSheet: {
    name: "Acme",
    website: "https://acme.dev",
    pricing: {
      tiers: {
        value: [{ name: "Starter", price: 9, currency: "USD", period: "month", limits: [], highlights: [] }],
        citations: [{ sourceId: SRC }],
        confidence: "high",
      },
    },
    features: [],
    ratings: [],
    limitations: [],
  },
  brief: null,
  article: {
    title: "Acme review",
    slug: "acme-review",
    overallScore: 7,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        children: [{ text: "Starter costs $9 per month.", marks: [{ type: "citation", citation: { sourceId: SRC } }] }],
      },
      {
        id: "p2",
        type: "paragraph",
        children: [
          { text: "The free trial lasts 14 days.", marks: [{ type: "citation", citation: { sourceId: SRC } }] },
        ],
      },
      {
        id: "p3",
        type: "paragraph",
        children: [{ text: "Acme tracks goals.", marks: [{ type: "citation", citation: { sourceId: SRC2 } }] }],
      },
    ],
  },
  competitors: [{ name: "Linear", websiteUrl: "https://linear.app", relation: "direct", note: "Faster" }],
};

const golden: GoldenCase = {
  slug: "acme",
  name: "Acme",
  url: "https://acme.dev",
  category: "developer-tools",
  snapshot: "acme",
  expect: {
    source: { url: "https://acme.dev/pricing", checkedAt: "2026-10-10", note: "fixture" },
    tiers: ["Starter", "Pro"],
    prices: [{ tier: "Starter", price: 9, period: "month", tolerance: 0 }],
    freePlan: null,
    trialDays: 14,
    features: ["goal"],
    rubricOverall: [5, 9],
  },
};

function structured(op: string, prompt: string): unknown {
  if (op === "extract_facts") {
    return {
      relevant: true,
      summary: "Acme",
      pricing: [],
      freePlan: { value: null, quote: "" },
      freeTrialDays: { value: 14, quote: "14-day" },
      moneyBackDays: { value: null, quote: "" },
      features: [],
      integrations: [],
      platforms: [],
      security: [],
      company: { name: null, foundedYear: null, headquarters: null, funding: null, quote: "" },
      ratings: [],
      support: [],
      limitations: [],
      opinions: [],
    };
  }
  if (op === "fact_sheet") {
    return {
      pricingTiers: [
        { name: "Starter", price: 9, currency: "USD", period: "month", limits: [], highlights: [] },
        { name: "Pro", price: 20, currency: "USD", period: "month", limits: [], highlights: [] },
      ],
      pricingRefs: ["S1"],
      pricingConfidence: "high",
      facts: [
        { field: "free_trial_days", value: "14", refs: ["S1"], confidence: "high" },
        { field: "feature", value: "Goal tracking", refs: ["S2"], confidence: "high" },
      ],
      ratings: [],
    };
  }
  if (op === "fact_check") {
    // Flags claims carrying a seeded (perturbed) figure, like a working fact-checker would.
    const claims = [...prompt.matchAll(/<claim id="([^"]+)"[^>]*>\n([^\n]*)/g)];
    return {
      results: claims.map(([, id, text]) => ({
        id,
        verdict: /\$23|33 days/.test(text!) ? "unsupported" : "supported",
        note: "",
        supportingRefs: ["S1"],
      })),
    };
  }
  throw new Error(`unexpected operation ${op}`);
}

function fakeLlm(onCost: (e: never) => void | Promise<void>): Llm {
  const base = (opts: GenerateOptions) => ({
    text: "",
    model: opts.model,
    stopReason: "end_turn",
    fallbackUsed: false,
    cost: {
      costUsd: 0.01,
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      models: [],
      unpricedModels: [],
    },
    raw: {} as never,
  });
  return {
    generate: async (opts: GenerateOptions) => base(opts),
    generateStructured: async <S extends z.ZodType>(opts: GenerateOptions & { schema: S }) => {
      await onCost({
        provider: "anthropic",
        operation: opts.operation,
        units: 2,
        unitType: "tokens",
        costUsd: 0.01,
      } as never);
      return { ...base(opts), data: opts.schema.parse(structured(opts.operation, opts.prompt ?? "")) };
    },
  } as unknown as Llm;
}

function deps() {
  const meter = costMeter();
  const services = evalServices(ctx.db, meter, (onCost) => fakeLlm(onCost));
  return { meter, deps: { db: ctx.db, services, llm: services.makeLlm(() => {}), noJudge: true } };
}

describe("eval harness", () => {
  it("derives a local eval database and refuses remote ones without an explicit URL", () => {
    expect(evalBaseUrl("postgres://u:p@localhost:5432/app")).toBe("postgres://u:p@localhost:5432/app_eval");
    expect(evalBaseUrl("postgres://u:p@db.example.com/app", "postgres://x@localhost/e")).toBe(
      "postgres://x@localhost/e",
    );
    expect(() => evalBaseUrl("postgres://u:p@db.example.com/app")).toThrow(/EVAL_DATABASE_URL/);
  });

  it("seeds a snapshot with original source ids, competitors and an article", async () => {
    const seeded = await seedSnapshot(ctx.db, snap, { factSheet: true, article: true });
    const sources = await listSources(ctx.db, seeded.productId);
    expect(sources.map((s) => s.id)).toEqual([SRC, SRC2]);
    expect((await latestFactSheet(ctx.db, seeded.productId))?.data.pricing?.tiers.citations).toEqual([
      { sourceId: SRC },
    ]);
    expect(seeded.articleId).not.toBeNull();
  });

  it("stores the snapshot brief as the job's seo_brief output for the write step", async () => {
    const brief = {
      primaryKeyword: "acme review",
      secondaryKeywords: [],
      intent: "review" as const,
      titleCandidates: ["Acme review"],
      title: "Acme review",
      slug: "acme-review",
      metaDescription: "Acme review",
      outline: [],
      faqQuestions: [],
      internalLinks: [],
      angle: null,
    };
    const seeded = await seedSnapshot(ctx.db, { ...snap, brief }, { factSheet: true, brief: true });
    const runs = await latestStepRuns(ctx.db, seeded.jobId);
    expect(runs.get("seo_brief")?.status).toBe("succeeded");
    expect(runs.get("seo_brief")?.output).toEqual({ brief });
    await expect(seedSnapshot(ctx.db, snap, { brief: true })).rejects.toThrow(/no SEO brief/);
  });

  it("switches prompt source between repo defaults and the main DB's overrides", async () => {
    // The same database plays "main" here; an override there is copied only in db mode.
    await savePromptVersion(ctx.db, { key: "fact_check", body: "Override body", activate: true });
    const main = ctx.db;
    expect((await promptVersions(main, ["fact_check"], "db")).fact_check).toMatch(/^fact_check@v1001 /);
    await ctx.reset();
    await applyPromptSource(ctx.db, null, "repo");
    expect(await getActivePromptOverride(ctx.db, "fact_check")).toBeNull();
    expect((await promptVersions(ctx.db, ["fact_check"], "repo")).fact_check).toMatch(/^fact_check@v[0-9]{1,3} /);
  });
});

describe("eval suites (fake model)", () => {
  it("fact_sheet: runs the real steps and grades the saved sheet", async () => {
    const { deps: d, meter } = deps();
    const res = await runFactSheetCase(d, golden, snap);
    expect(res.status).toBe("passed");
    expect(res.metrics).toMatchObject({ tierRecall: 1, priceAccuracy: 1, featureRecall: 1 });
    expect(meter.total()).toBeGreaterThan(0);
  });

  it("fact_check: detects seeded wrong figures with full recall and precision", async () => {
    const { deps: d } = deps();
    const res = await runFactCheckCase({ ...d, seededErrors: 2, controlClaims: 5 }, golden, snap);
    expect(res.seeded).toEqual([
      { blockId: "p1", from: "$9", to: "$23" },
      { blockId: "p2", from: "14", to: "33" },
    ]);
    expect(res.metrics).toMatchObject({ recall: 1, precision: 1, seeded: 2, controlFlagged: 0 });
    expect(res.status).toBe("passed");
  });
});
