import type { FirecrawlAdapter, GenerateOptions, Llm } from "@repo/ai";
import { createReviewJob, getJob, latestFactSheet, listArticles, listPrograms, listVersions } from "@repo/core";
import { articles, eq, products, sql } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { createDbStorage } from "@repo/media";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { prepareRerun, runReviewJob, type StepServices } from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
});

const SITE = "https://acme.dev";
let plusPrice = 12;

const pages = (): Record<string, string> => ({
  [SITE]: `# Acme\nAcme is a project tracker for small software teams. ${"Plan sprints, track issues and ship. ".repeat(10)}`,
  [`${SITE}/pricing`]:
    `# Pricing\nFree plan for up to 3 users. Plus costs $${plusPrice} per user per month billed annually. Business costs $24 per user per month. 14-day free trial.`.repeat(
      3,
    ),
  [`${SITE}/features`]: `# Features\nIssue tracking, sprint planning, roadmaps, GitHub integration, Slack integration, REST API. ${"Keyboard-first interface. ".repeat(10)}`,
  [`${SITE}/security`]: `# Security\nAcme is SOC 2 Type II certified. SSO with SAML on Business. Data encrypted at rest. ${"Audit logs available. ".repeat(10)}`,
  "https://www.g2.com/products/acme/reviews": `Acme reviews on G2. Rated 4.6 out of 5 from 312 reviews. Users praise speed; some want better reporting. ${"Reviewers like the keyboard shortcuts. ".repeat(10)}`,
  "https://www.reddit.com/r/projectmanagement/acme": `Thread: anyone using Acme? Replies say it is fast but lacks time tracking. ${"It feels quick compared to Jira. ".repeat(10)}`,
  "https://blog.example.com/acme-review": `Acme review: a lean tracker. The Plus plan is $${plusPrice}. ${"Good for startups that want speed. ".repeat(10)}`,
});

function firecrawl(): FirecrawlAdapter {
  return {
    async map() {
      return [
        `${SITE}/`,
        `${SITE}/pricing`,
        `${SITE}/features`,
        `${SITE}/security`,
        `${SITE}/blog/post-1`,
        `${SITE}/fr/pricing`,
      ];
    },
    async scrape(url: string, opts: { screenshot?: boolean; mobile?: boolean } = {}) {
      const key = url.replace(/\/$/, "");
      const markdown = pages()[key] ?? "";
      return {
        url: key,
        title: key.split("/").pop() || "Acme",
        markdown,
        links: [`${SITE}/pricing`, `${SITE}/docs`, "https://x.com/acmedev", "https://github.com/acme"],
        screenshotUrl: opts.screenshot
          ? `https://shots.example/${encodeURIComponent(key)}${opts.mobile ? "-m" : ""}.png`
          : null,
        statusCode: markdown ? 200 : 404,
        description: "Acme project tracker",
        ogImage: null,
        favicon: null,
      };
    },
    async search(query: string) {
      if (query.includes("alternatives"))
        return [{ url: "https://linear.app", title: "Linear", description: "Linear alternatives" }];
      if (query.includes("affiliate"))
        return [{ url: `${SITE}/affiliates`, title: "Acme affiliates", description: "Earn 30%" }];
      return [
        { url: "https://www.g2.com/products/acme/reviews", title: "Acme Reviews | G2", description: "Acme reviews" },
        { url: "https://www.reddit.com/r/projectmanagement/acme", title: "Acme thoughts", description: "acme" },
        { url: "https://blog.example.com/acme-review", title: "Acme review", description: "acme review" },
      ];
    },
  } as unknown as FirecrawlAdapter;
}

const fetchImpl = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private", { status: 200 });
  if (url.startsWith("https://shots.example/") || url.endsWith("apple-touch-icon.png")) {
    // Distinct bytes per URL, like real screenshots (assets are content-addressed).
    const shade = [...url].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 255, 7);
    const img = await sharp({
      create: { width: 1280, height: 800, channels: 3, background: { r: shade, g: 70, b: 229 } },
    })
      .png()
      .toBuffer();
    return new Response(new Uint8Array(img), { headers: { "content-type": "image/png" } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

/** Structured outputs per operation; refs S1..S3 always exist once research has run. */
function structured(op: string, prompt: string): unknown {
  switch (op) {
    case "resolve_product":
      return {
        name: "Acme",
        tagline: "Project tracker for small software teams",
        categorySlug: "developer-tools",
        pricingUrl: `${SITE}/pricing`,
        docsUrl: `${SITE}/docs`,
        changelogUrl: null,
        socials: [
          { network: "x", url: "https://x.com/acmedev" },
          { network: "github", url: "https://evil.example/acme" },
        ],
        appStores: [],
      };
    case "extract_facts":
      return {
        relevant: true,
        summary: "About Acme",
        pricing: [
          {
            tier: "Plus",
            price: plusPrice,
            currency: "USD",
            period: "month",
            limits: ["per user"],
            quote: "Plus costs",
          },
        ],
        freePlan: { value: true, quote: "Free plan" },
        freeTrialDays: { value: 14, quote: "14-day" },
        moneyBackDays: { value: null, quote: "" },
        features: [{ value: "Issue tracking", quote: "Issue tracking" }],
        integrations: ["GitHub"],
        platforms: ["Web"],
        security: [{ value: "SOC 2 Type II", quote: "SOC 2" }],
        company: { name: null, foundedYear: null, headquarters: null, funding: null, quote: "" },
        ratings: [],
        support: [],
        limitations: [],
        opinions: [],
      };
    case "fact_sheet": {
      const fact = (field: string, value: string) => ({ field, value, refs: ["S1"], confidence: "high" });
      return {
        pricingTiers: [
          { name: "Free", price: 0, currency: "USD", period: "month", limits: ["Up to 3 users"], highlights: [] },
          {
            name: "Plus",
            price: plusPrice,
            currency: "USD",
            period: "month",
            limits: ["Per user, billed annually"],
            highlights: ["Unlimited issues"],
          },
          { name: "Business", price: 24, currency: "USD", period: "month", limits: [], highlights: ["SAML SSO"] },
        ],
        pricingRefs: ["S1"],
        pricingConfidence: "high",
        facts: [
          fact("tagline", "Project tracker for small software teams"),
          fact("free_plan", "true"),
          fact("free_trial_days", "14"),
          fact("feature", "Issue tracking"),
          fact("feature", "Sprint planning"),
          fact("feature", "Roadmaps"),
          fact("platform", "Web"),
          fact("integration", "GitHub"),
          fact("integration", "Slack"),
          fact("security", "SOC 2 Type II"),
          fact("limitation", "No built-in time tracking"),
          { field: "funding", value: "Seed", refs: [], confidence: "low" },
        ],
        ratings: [{ site: "G2", rating: 4.6, outOf: 5, count: 312, ref: "S2" }],
      };
    }
    case "affiliate_discovery":
      return {
        programs: [
          {
            name: "Acme Partners",
            network: "rewardful",
            commissionModel: "recurring_percent",
            commissionValue: 30,
            recurringMonths: 12,
            cookieDays: 60,
            signupUrl: `${SITE}/affiliates`,
            termsUrl: null,
            linkFormat: "query_param",
            linkParam: "via",
            redirectPolicy: "unknown",
            evidence: [{ url: `${SITE}/affiliates`, note: "30% for 12 months" }],
            draftApplication: "Hello Acme team...",
          },
        ],
      };
    case "competitors":
      return {
        competitors: [
          {
            name: "Linear",
            website: "https://linear.app",
            positioning: "Faster, opinionated tracker",
            relation: "direct",
          },
          { name: "Acme again", website: "https://app.acme.dev", positioning: "self", relation: "direct" },
          {
            name: "Jira",
            website: "atlassian.com/software/jira",
            positioning: "Enterprise standard",
            relation: "alternative",
          },
        ],
      };
    case "seo_brief":
      return {
        primaryKeyword: "acme review",
        secondaryKeywords: ["acme pricing", "acme alternatives"],
        intent: "review",
        titleCandidates: ["Acme Review 2026: Fast Tracker for Small Teams"],
        title: "Acme Review 2026: Fast Tracker for Small Teams",
        slug: "Acme Review",
        metaDescription:
          "Our Acme review covers pricing from $12 per user, features, security and alternatives, so you can decide if this fast tracker fits your team.",
        outline: [{ heading: "Pricing", points: ["Plus at $12"] }],
        faqQuestions: ["Is Acme free?"],
        internalLinks: [{ articleId: "00000000-0000-0000-0000-000000000000", anchor: "bogus" }],
        angle: null,
      };
    case "write": {
      const para = (topic: string) =>
        `We looked at ${topic} closely for teams that ship weekly and value focus over configuration options.[^S1] Our notes cover what changes day to day for a five person team.`;
      return {
        title: "Acme Review 2026: Fast Tracker for Small Teams",
        metaDescription:
          "Our Acme review covers pricing from $12 per user, features, security and alternatives, so you can decide if this fast tracker fits your team.",
        verdictSummary: "Acme is a fast tracker for small teams.[^S1] Pick it if speed matters more than reports.",
        bestFor: ["Small software teams"],
        notFor: ["Teams needing time tracking"],
        intro: ["Acme keeps issue tracking quick and simple for small product teams that ship often."],
        sections: [
          "overview",
          "features",
          "ease_of_use",
          "pricing",
          "hands_on",
          "support",
          "security",
          "alternatives",
        ].map((key) => ({
          key,
          heading: key.replace("_", " "),
          paragraphs: [
            para(key),
            key === "pricing"
              ? `The Plus plan costs $${plusPrice} per user per month.[^S1] Business costs $24.[^S1]`
              : para(`${key} details`),
          ],
          bullets: key === "features" ? ["Issue tracking[^S1]", "Roadmaps"] : [],
        })),
        pros: ["Fast keyboard-first interface", "Generous free plan"],
        cons: ["No time tracking"],
        rubric: ["features", "ease_of_use", "value", "support", "integrations", "security"].map((key) => ({
          key,
          score: 8.3,
          justification: `Solid ${key}.`,
          refs: ["S1"],
        })),
        comparisonRows: [{ label: "Starting price", values: ["Free", "Free", "Free"] }],
        faq: [{ question: "Is Acme free?", answer: "Yes, for up to 3 users.[^S1]" }],
        finalVerdict: ["We recommend Acme for small teams that want speed."],
        ctaLabel: "Try Acme free",
        screenshotCaptions: [
          { role: "screenshot:home:desktop", caption: "Acme homepage", alt: "Acme homepage on desktop" },
        ],
      };
    }
    case "fact_check": {
      const ids = [...prompt.matchAll(/<claim id="([^"]+)"/g)].map((m) => m[1]!);
      // The first figure-without-citation claim is unsupported; the rest pass.
      return {
        results: ids.map((id) => ({
          id,
          verdict: prompt.includes(`<claim id="${id}" uncited="true">`) ? "unsupported" : "supported",
          note: "checked",
          supportingRefs: [],
        })),
      };
    }
    case "fact_fix": {
      const blocks = JSON.parse(prompt.slice(prompt.indexOf("["), prompt.indexOf("\n\nProblems:"))) as Array<{
        id: string;
        lines: string[];
      }>;
      return {
        blocks: blocks.map((b) => ({
          id: b.id,
          lines: b.lines.map((l) => l.replace(/Business costs \$24\./, "Business costs $24.[^S1]")),
        })),
      };
    }
    case "style_pass": {
      const blocks = JSON.parse(prompt.slice(prompt.indexOf("["))) as Array<{ id: string; lines: string[] }>;
      return {
        blocks: blocks.map((b) => ({
          id: b.id,
          // Edits the wording; one line drops a citation marker and must be rejected.
          lines: b.lines.map((l) =>
            b.id === "intro-0" ? l.replace("quick and simple", "fast") : l.replace("[^S1] Our notes", " Our notes"),
          ),
        })),
      };
    }
    default:
      throw new Error(`unexpected operation ${op}`);
  }
}

function fakeLlm(): Llm {
  const base = (opts: GenerateOptions) => ({
    text: "",
    model: opts.model,
    stopReason: "end_turn",
    fallbackUsed: false,
    cost: {
      costUsd: 0.01,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      models: [opts.model],
      unpricedModels: [],
    },
    raw: {} as never,
  });
  return {
    generate: async (opts) => base(opts),
    generateStructured: async <S extends z.ZodType>(opts: GenerateOptions & { schema: S }) => {
      const data = opts.schema.parse(structured(opts.operation, opts.prompt ?? ""));
      return { ...base(opts), data };
    },
  } as Llm;
}

function services(): StepServices {
  return {
    db: ctx.db,
    makeLlm: (onCost) => {
      const llm = fakeLlm();
      return {
        ...llm,
        generateStructured: async (opts) => {
          const res = await llm.generateStructured(opts);
          await onCost({
            provider: "anthropic",
            model: opts.model,
            operation: opts.operation,
            units: 150,
            unitType: "tokens",
            costUsd: 0.01,
            meta: { inputTokens: 100, outputTokens: 50 },
          });
          return res;
        },
      } as Llm;
    },
    makeFirecrawl: () => firecrawl(),
    makeEmbedder: () => null,
    storage: createDbStorage(ctx.db),
    fetch: fetchImpl,
  };
}

describe("review pipeline end to end (fakes)", () => {
  it("turns a URL into an in-review article with QA, graphics and an affiliate program", async () => {
    plusPrice = 12;
    const job = await createReviewJob(ctx.db, {
      preset: "quick_review",
      input: { url: "acme.dev/", angle: "for small teams" },
    });
    const result = await runReviewJob(services(), job.id);
    expect(result.qa.hardGatesPassed).toBe(true);

    const loaded = await getJob(ctx.db, job.id);
    expect(loaded!.status).toBe("succeeded");
    expect(loaded!.articleId).toBe(result.articleId);
    expect(new Set(loaded!.steps.map((s) => s.name)).size).toBe(14);
    expect(loaded!.steps.every((s) => s.status === "succeeded")).toBe(true);
    expect(Number(loaded!.totalCostUsd)).toBeGreaterThan(0);

    const [article] = await listArticles(ctx.db);
    expect(article).toMatchObject({ status: "in_review", slug: "acme-review", hardGatesPassed: true });
    const versions = await listVersions(ctx.db, result.articleId);
    expect(versions.map((v) => v.changeNote?.split(":")[0])).toEqual([
      "Style pass",
      "Fact-check",
      "Generated by the write step",
    ]);

    const sheet = await latestFactSheet(ctx.db, result.productId);
    expect(sheet!.version).toBe(1);
    expect(sheet!.data.ratings[0]).toMatchObject({ site: "G2", rating: 4.6, count: 312 });

    const [product] = await ctx.db.select().from(products).where(eq(products.id, result.productId));
    expect(product!.profile?.socials).toEqual({ x: "https://x.com/acmedev" });
    expect(product!.logoAssetId).toBeTruthy();
    const programs = await listPrograms(ctx.db, { productId: result.productId });
    expect(programs[0]!.program).toMatchObject({ network: "rewardful", status: "found" });

    // Competitors: self-reference skipped, Jira URL normalised.
    const competitorCount = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from competitors`);
    expect(competitorCount[0]!.n).toBe(2);

    const media = await ctx.db.execute<{ role: string }>(sql`select role from media_assets order by role`);
    expect(media.map((m) => m.role)).toEqual(
      expect.arrayContaining([
        "og",
        "pricing_card",
        "pros_cons",
        "score_badge",
        "screenshot:home:desktop",
        "screenshot:pricing:mobile",
        "logo",
      ]),
    );
  }, 60_000);

  it("refresh re-runs research into a fact-sheet diff without duplicating product or article", async () => {
    plusPrice = 12;
    const first = await runReviewJob(
      services(),
      (await createReviewJob(ctx.db, { preset: "quick_review", input: { url: SITE } })).id,
    );
    plusPrice = 15;
    const refresh = await createReviewJob(ctx.db, {
      preset: "refresh",
      input: { productId: first.productId },
      productId: first.productId,
    });
    const second = await runReviewJob(services(), refresh.id);
    expect(second.productId).toBe(first.productId);
    expect(second.articleId).toBe(first.articleId);
    const sheet = await latestFactSheet(ctx.db, first.productId);
    expect(sheet!.version).toBe(2);
    expect(sheet!.diffFromPrevious).toEqual(
      expect.arrayContaining([{ path: "pricing.tiers[1].price", before: 12, after: 15 }]),
    );
    expect((await ctx.db.select().from(products)).filter((p) => p.domain === "acme.dev")).toHaveLength(1);
    expect(await ctx.db.select().from(articles)).toHaveLength(1);
  }, 60_000);

  it("re-runs from a step with fresh attempts and reuses earlier outputs", async () => {
    plusPrice = 12;
    const job = await createReviewJob(ctx.db, { preset: "quick_review", input: { url: SITE } });
    await runReviewJob(services(), job.id);
    await prepareRerun(ctx.db, job.id, "style_pass");
    expect((await getJob(ctx.db, job.id))!.status).toBe("queued");
    await runReviewJob(services(), job.id);
    const steps = (await getJob(ctx.db, job.id))!.steps;
    const attempts = (name: string) => steps.filter((s) => s.name === name).map((s) => [s.attempt, s.status]);
    expect(attempts("write")).toEqual([[1, "succeeded"]]);
    expect(attempts("style_pass")).toEqual([
      [1, "stale"],
      [2, "succeeded"],
    ]);
    expect(attempts("qa_gates")).toEqual([
      [1, "stale"],
      [2, "succeeded"],
    ]);
  }, 60_000);
});
