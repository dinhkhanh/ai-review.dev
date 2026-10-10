import type { FirecrawlAdapter, GenerateOptions, Llm } from "@repo/ai";
import {
  approveJobOverCeiling,
  createLink,
  createReviewJob,
  findOrCreateProduct,
  getCurrentVersion,
  getJob,
  latestFactSheet,
  listArticles,
  listJobs,
  listLinks,
  listNotifications,
  listPrograms,
  listVersions,
  publishArticle,
  saveFactSheet,
  setSetting,
  transitionArticle,
  upsertSource,
} from "@repo/core";
import { articles, eq, products, sql } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { createDbStorage } from "@repo/media";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { JobPausedError, prepareRerun, runReviewJob, type StepServices } from "./index";

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
let siteDown = false;

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
  if (url === SITE || url === `${SITE}/`)
    return siteDown ? new Response("gone", { status: 410 }) : new Response("<h1>Acme</h1>");
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
    case "social":
      return {
        x: "Acme is a fast tracker for small teams; Plus is $12 per user. https://example.com/x",
        linkedin: "Choosing a tracker for a small team?\nAcme is fast and has a free plan.",
        threads: "Acme review: fast, simple, free for 3 users.",
      };
    case "section_regenerate":
      return {
        heading: "Pricing",
        paragraphs: [`The Plus plan now costs $${plusPrice} per user per month.[^S1]`],
        bullets: [],
      };
    case "derivative_brief":
      return {
        primaryKeyword: "acme vs linear",
        secondaryKeywords: ["acme or linear"],
        intent: "comparison",
        titleCandidates: ["Acme vs Linear"],
        title: "Acme vs Linear (2026): Which Tracker Fits Your Team?",
        slug: "Acme vs Linear",
        metaDescription:
          "Acme vs Linear compared on pricing, features and fit for small teams, with cited facts from both vendors so you can pick the right tracker.",
        outline: [{ heading: "Pricing compared", points: ["Plus vs Standard"] }],
        faqQuestions: ["Is Acme cheaper than Linear?"],
        internalLinks: [{ articleId: "00000000-0000-0000-0000-000000000000", anchor: "bogus" }],
        angle: null,
      };
    case "derivative_write": {
      const line = (name: string) =>
        `${name} keeps planning simple for teams that ship weekly and prefer focus over configuration.[^S1]`;
      return {
        title: "Acme vs Linear (2026): Which Tracker Fits Your Team?",
        metaDescription:
          "Acme vs Linear compared on pricing, features and fit for small teams, with cited facts from both vendors so you can pick the right tracker.",
        verdictSummary: "Pick Acme for a free start; pick Linear for a polished roadmap tool.[^S1]",
        intro: ["We compared both trackers from their official pages and third-party reviews."],
        entries: [
          {
            product: "P1",
            bestFor: "small teams",
            paragraphs: [line("Acme")],
            pros: ["Free plan"],
            cons: ["No time tracking"],
            pricingNote: "Plus costs $12 per user.[^S1]",
          },
          {
            product: "P2",
            bestFor: "product orgs",
            paragraphs: [line("Linear")],
            pros: ["Fast"],
            cons: ["Opinionated"],
            pricingNote: "Standard costs $8 per user.[^S2]",
          },
          { product: "P9", bestFor: "nobody", paragraphs: ["Ghost entry."], pros: [], cons: [], pricingNote: "" },
        ],
        sections: [
          { heading: "Pricing compared", paragraphs: [line("Pricing for Acme and Linear")], bullets: [] },
          { heading: "Features compared", paragraphs: [line("Acme and Linear")], bullets: ["Roadmaps[^S2]"] },
          { heading: "How to choose", paragraphs: [line("The choice")], bullets: [] },
        ],
        comparisonRows: [{ label: "Free plan", values: ["Yes", "Yes"] }],
        faq: [{ question: "Is Acme cheaper than Linear?", answer: "Acme has a free plan for 3 users.[^S1]" }],
        finalVerdict: ["Both are good; the free plan tips small teams to Acme."],
        ctaLabel: "Visit website",
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
    publishEnv: { siteUrl: "https://ai-review.test", revalidateSecret: null, indexNowKey: null },
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
    expect(result.qa!.hardGatesPassed).toBe(true);
    expect(result.outcome).toBe("review");

    const loaded = await getJob(ctx.db, job.id);
    expect(loaded!.status).toBe("succeeded");
    expect(loaded!.articleId).toBe(result.articleId);
    expect(new Set(loaded!.steps.map((s) => s.name)).size).toBe(16);
    expect(loaded!.steps.every((s) => s.status === "succeeded")).toBe(true);
    expect(Number(loaded!.totalCostUsd)).toBeGreaterThan(0);

    const [article] = await listArticles(ctx.db);
    expect(article).toMatchObject({ status: "in_review", slug: "acme-review", hardGatesPassed: true });
    const [row] = await ctx.db.select().from(articles).where(eq(articles.id, result.articleId));
    expect(row!.social?.x).toMatch(/\/reviews\/acme-review$/);
    expect(row!.social!.x.length).toBeLessThanOrEqual(280);
    const events = (await listNotifications(ctx.db)).map((n) => n.event);
    expect(events).toEqual(expect.arrayContaining(["job.succeeded", "article.awaiting_review"]));
    const versions = await listVersions(ctx.db, result.articleId);
    expect(versions.map((v) => v.changeNote?.split(":")[0])).toEqual([
      "Style pass",
      "Fact-check",
      "Generated by the write step",
    ]);

    const sheet = await latestFactSheet(ctx.db, result.productId!);
    expect(sheet!.version).toBe(1);
    expect(sheet!.data.ratings[0]).toMatchObject({ site: "G2", rating: 4.6, count: 312 });

    const [product] = await ctx.db.select().from(products).where(eq(products.id, result.productId!));
    expect(product!.profile?.socials).toEqual({ x: "https://x.com/acmedev" });
    expect(product!.logoAssetId).toBeTruthy();
    const programs = await listPrograms(ctx.db, { productId: result.productId! });
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
        "screenshot:home:desktop:processed",
        "screenshot:pricing:desktop:processed",
        "screenshot:pricing:mobile",
        "logo",
      ]),
    );
  }, 60_000);

  async function publishedReview() {
    const first = await runReviewJob(
      services(),
      (await createReviewJob(ctx.db, { preset: "quick_review", input: { url: SITE } })).id,
    );
    await transitionArticle(ctx.db, first.articleId, "approved");
    await publishArticle(ctx.db, first.articleId);
    return first;
  }

  async function refreshJob(productId: string) {
    const job = await createReviewJob(ctx.db, { preset: "refresh", input: { productId }, productId });
    return runReviewJob(services(), job.id);
  }

  it("refresh of a live article rewrites only changed sections into a version for review", async () => {
    plusPrice = 12;
    const first = await publishedReview();
    const [before] = await ctx.db.select().from(articles).where(eq(articles.id, first.articleId));
    plusPrice = 15;
    const second = await refreshJob(first.productId!);
    expect(second.productId!).toBe(first.productId!);
    expect(second.articleId).toBe(first.articleId);
    expect(second.outcome).toBe("review");
    const sheet = await latestFactSheet(ctx.db, first.productId!);
    expect(sheet!.version).toBe(2);
    expect(sheet!.diffFromPrevious).toEqual(
      expect.arrayContaining([{ path: "pricing.tiers[1].price", before: 12, after: 15 }]),
    );
    expect((await ctx.db.select().from(products)).filter((p) => p.domain === "acme.dev")).toHaveLength(1);
    expect(await ctx.db.select().from(articles)).toHaveLength(1);

    const [after] = await ctx.db.select().from(articles).where(eq(articles.id, first.articleId));
    // The live version stays published until the refresh is approved (C-6).
    expect(after!.publishedVersionId).toBe(before!.publishedVersionId);
    expect(after!.status).toBe("in_review");
    const versions = await listVersions(ctx.db, first.articleId);
    expect(versions.some((v) => v.changeNote?.startsWith("Refresh:"))).toBe(true);
    const current = await getCurrentVersion(ctx.db, first.articleId);
    const table = current!.blocks.find((b) => b.type === "pricing_table");
    expect(table?.type === "pricing_table" && table.tiers.find((t) => t.name === "Plus")?.price).toBe(15);
    // The price change is queued for mobile push alerts (FR-API-4).
    const changes = await ctx.db.execute<{ summary: string }>(sql`select summary from price_changes`);
    expect(changes.map((c) => c.summary)).toEqual(["Plus: $12/mo → $15/mo"]);
    const steps = (await getJob(ctx.db, (await listJobs(ctx.db))[0]!.id))!.steps.map((s) => s.name);
    expect(steps).toEqual(expect.arrayContaining(["site_check", "refresh_plan", "refresh_rewrite", "fact_check"]));
    expect(steps).not.toContain("write");
    const [product] = await ctx.db.select().from(products).where(eq(products.id, first.productId!));
    expect(product!.nextRefreshAt!.getTime()).toBeGreaterThan(Date.now() + 50 * 24 * 3600 * 1000);
    expect((await listNotifications(ctx.db)).map((n) => n.event)).toContain("article.awaiting_review");
  }, 60_000);

  it("refresh without material changes re-verifies the article without a new version", async () => {
    plusPrice = 12;
    const first = await publishedReview();
    const versionsBefore = (await listVersions(ctx.db, first.articleId)).length;
    await ctx.db
      .update(articles)
      .set({ lastVerifiedAt: new Date("2026-01-01") })
      .where(eq(articles.id, first.articleId));
    const second = await refreshJob(first.productId!);
    expect(second.outcome).toBe("verified");
    expect((await listVersions(ctx.db, first.articleId)).length).toBe(versionsBefore);
    const [after] = await ctx.db.select().from(articles).where(eq(articles.id, first.articleId));
    expect(after!.status).toBe("published");
    expect(after!.lastVerifiedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  }, 60_000);

  it("refresh of a vanished site marks the product discontinued and pauses its links", async () => {
    plusPrice = 12;
    const first = await publishedReview();
    await createLink(ctx.db, { productId: first.productId!, label: "Main", destinationUrl: SITE, status: "active" });
    siteDown = true;
    try {
      const job = await createReviewJob(ctx.db, {
        preset: "refresh",
        input: { productId: first.productId! },
        productId: first.productId!,
      });
      const result = await runReviewJob(services(), job.id);
      expect(result.outcome).toBe("discontinued");
    } finally {
      siteDown = false;
    }
    const [product] = await ctx.db.select().from(products).where(eq(products.id, first.productId!));
    expect(product).toMatchObject({ status: "discontinued", nextRefreshAt: null });
    expect(product!.statusNote).toMatch(/no longer reachable/);
    expect((await listLinks(ctx.db, first.productId!)).map((l) => l.status)).toEqual(["paused"]);
    expect((await listNotifications(ctx.db)).map((n) => n.event)).toContain("product.discontinued");
  }, 60_000);

  it("pauses at the cost ceiling and continues after approval", async () => {
    plusPrice = 12;
    const job = await createReviewJob(ctx.db, { preset: "quick_review", input: { url: SITE }, costCeilingUsd: 0.05 });
    await expect(runReviewJob(services(), job.id)).rejects.toThrow(JobPausedError);
    const paused = (await getJob(ctx.db, job.id))!;
    expect(paused.status).toBe("awaiting_approval");
    expect(paused.steps.some((s) => s.name === "qa_gates")).toBe(false);
    expect((await listNotifications(ctx.db)).map((n) => n.event)).toContain("job.awaiting_approval");
    await approveJobOverCeiling(ctx.db, job.id, 50);
    const result = await runReviewJob(services(), job.id);
    expect(result.qa!.hardGatesPassed).toBe(true);
    expect((await getJob(ctx.db, job.id))!.status).toBe("succeeded");
  }, 60_000);

  it("auto-publishes when the category is opted in and human review is off", async () => {
    plusPrice = 12;
    await setSetting(ctx.db, "publishing.requireHumanReview", false);
    await setSetting(ctx.db, "publishing.autoPublishCategories", ["developer-tools"]);
    await setSetting(ctx.db, "publishing.autoPublish", { minSoftScore: 0 });
    const job = await createReviewJob(ctx.db, { preset: "quick_review", input: { url: SITE } });
    const result = await runReviewJob(services(), job.id);
    expect(result.outcome).toBe("published");
    const [row] = await ctx.db.select().from(articles).where(eq(articles.id, result.articleId));
    expect(row!.status).toBe("published");
    expect(row!.publishedVersionId).toBe(row!.currentVersionId);
    expect((await listNotifications(ctx.db)).map((n) => n.event)).toContain("article.auto_published");
  }, 60_000);

  it("writes a comparison from two researched products and reuses the article on re-runs (FR-CON-8)", async () => {
    const ids: string[] = [];
    for (const [name, site, price] of [
      ["Acme", "https://acme.dev", 12],
      ["Linear", "https://linear.app", 8],
    ] as const) {
      const { product } = await findOrCreateProduct(ctx.db, { name, websiteUrl: site });
      await upsertSource(ctx.db, {
        productId: product.id,
        url: `${site}/pricing`,
        kind: "official",
        title: `${name} pricing`,
        contentMd: `${name} pricing. The paid plan costs $${price} per user per month. Free plan available.`,
      });
      await saveFactSheet(ctx.db, product.id, {
        name,
        website: site,
        features: [{ value: "Issue tracking", citations: [], confidence: "high" }],
        ratings: [],
        limitations: [],
      });
      ids.push(product.id);
    }
    const job = await createReviewJob(ctx.db, { preset: "comparison", input: { productIds: ids } });
    const result = await runReviewJob(services(), job.id);
    expect(result.outcome).toBe("review");
    expect(result.qa!.hardGatesPassed).toBe(true);
    const [article] = await ctx.db.select().from(articles).where(eq(articles.id, result.articleId));
    expect(article).toMatchObject({ type: "comparison", slug: "acme-vs-linear", productId: null });
    expect(new Set(article!.productIds)).toEqual(new Set(ids));
    const blocks = (await getCurrentVersion(ctx.db, result.articleId))!.blocks;
    const ctas = blocks.filter((b) => b.type === "cta");
    expect(ctas.map((b) => (b.type === "cta" ? b.placement : ""))).toEqual(["pick_1", "pick_2"]);
    expect(new Set(ctas.map((b) => (b.type === "cta" ? b.goSlug : ""))).size).toBe(2);
    expect(blocks.some((b) => b.type === "comparison_table")).toBe(true);
    expect(blocks.filter((b) => b.type === "pricing_table")).toHaveLength(0);
    const steps = (await getJob(ctx.db, job.id))!.steps.map((s) => s.name);
    expect(steps).toEqual(
      expect.arrayContaining(["derivative_prepare", "derivative_brief", "derivative_write", "fact_check"]),
    );

    const again = await runReviewJob(
      services(),
      (await createReviewJob(ctx.db, { preset: "comparison", input: { productIds: [...ids].reverse() } })).id,
    );
    expect(again.articleId).toBe(result.articleId);
    expect((await listVersions(ctx.db, result.articleId)).length).toBeGreaterThan(1);
  }, 60_000);

  it("refuses a comparison when a product has not been researched", async () => {
    const { product } = await findOrCreateProduct(ctx.db, { name: "Acme", websiteUrl: SITE });
    const { product: other } = await findOrCreateProduct(ctx.db, { name: "Linear", websiteUrl: "https://linear.app" });
    const job = await createReviewJob(ctx.db, { preset: "comparison", input: { productIds: [product.id, other.id] } });
    await expect(runReviewJob(services(), job.id)).rejects.toThrow(/Research these products first .*: Acme, Linear/);
  });

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
