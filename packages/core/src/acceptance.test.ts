import { factSheetSchema, type ArticleBody, type FactCheckReport, type QaScorecard } from "@repo/content";
import { costLedger, eq, factSheets, mediaAssets, reviewJobs, articles, products, sql } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addArticleVersion,
  createArticle,
  createReviewJob,
  ensureGoSlug,
  evaluateJobAcceptance,
  finishStep,
  findOrCreateProduct,
  goSlugsInBlocks,
  listAcceptanceCandidates,
  publishArticle,
  saveFactSheet,
  setJobLinks,
  setJobStatus,
  setSetting,
  startStep,
  transitionArticle,
  upsertSource,
  type JobAcceptance,
} from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
});

const uuid = () => crypto.randomUUID();

function sheet(sourceId: string, opts: { citeAll?: boolean } = {}) {
  const c = [{ sourceId }];
  return factSheetSchema.parse({
    name: "Acme",
    website: "https://acme.dev",
    pricing: {
      tiers: { value: [{ name: "Plus", price: 12, period: "month" }], citations: c },
      freePlan: { value: true, citations: c },
      freeTrialDays: { value: 14, citations: opts.citeAll === false ? [] : c },
    },
  });
}

function blocks(sourceId: string, goSlug: string, imageIds: string[], dims = 5): ArticleBody {
  return [
    { id: "v", type: "verdict", score: 7.5, summary: "Good", bestFor: [], notFor: [] },
    {
      id: "r",
      type: "rubric",
      dimensions: Array.from({ length: dims }, (_, i) => ({
        key: `d${i}`,
        label: `D${i}`,
        weight: 1 / dims,
        score: 7,
        justification: "ok",
        citations: [{ sourceId }],
      })),
    },
    { id: "c1", type: "cta", goSlug, placement: "verdict", label: "Try Acme" },
    {
      id: "p",
      type: "paragraph",
      children: [{ text: "Plus costs $12.", marks: [{ type: "golink", slug: goSlug, placement: "inline" }] }],
    },
    ...imageIds.map((assetId, i) => ({ id: `img${i}`, type: "image" as const, assetId })),
  ];
}

const factCheck = (verdicts: Array<"supported" | "unsupported" | "outdated">): FactCheckReport => ({
  claims: verdicts.map((verdict, i) => ({
    id: `c${i}`,
    blockId: "p",
    text: "claim",
    sourceIds: [],
    verdict,
    note: null,
    fixed: false,
  })),
  supported: verdicts.filter((v) => v === "supported").length,
  unsupported: verdicts.filter((v) => v === "unsupported").length,
  outdated: verdicts.filter((v) => v === "outdated").length,
  uncited: 0,
  fixedCount: 0,
  checkedAt: new Date().toISOString(),
});

const scorecard = (passed = true): QaScorecard => ({
  hardGatesPassed: passed,
  checks: [{ key: "structured_data", label: "Structured data valid", hard: true, passed }],
  computedAt: new Date().toISOString(),
});

async function media(productId: string, articleId: string | null, role: string, kind: "screenshot" | "graphic") {
  const [row] = await ctx.db
    .insert(mediaAssets)
    .values({
      kind,
      origin: kind === "screenshot" ? "captured" : "templated",
      storageKey: `test/${uuid()}.png`,
      storage: "db",
      mimeType: "image/png",
      role,
      productId,
      articleId,
      capturedAt: new Date(),
    })
    .returning();
  return row!.id;
}

type Fixture = {
  preset?: "quick_review" | "full_review";
  sources?: { official: number; thirdParty: number };
  citeAll?: boolean;
  shots?: string[];
  graphics?: string[];
  verdicts?: Array<"supported" | "unsupported" | "outdated">;
  costUsd?: number;
  minutesToReview?: number;
  dims?: number;
};

/** A review job that went through the pipeline, as the steps would have stored it. */
async function reviewJob(f: Fixture = {}) {
  const { product } = await findOrCreateProduct(ctx.db, { name: "Acme", websiteUrl: "https://acme.dev" });
  const job = await createReviewJob(ctx.db, {
    preset: f.preset ?? "quick_review",
    input: { url: "https://acme.dev" },
    productId: product.id,
  });
  const { official = 6, thirdParty = 3 } = f.sources ?? {};
  const sourceIds: string[] = [];
  for (let i = 0; i < official + thirdParty; i++) {
    const s = await upsertSource(ctx.db, {
      productId: product.id,
      url: i < official ? `https://acme.dev/p${i}` : `https://www.g2.com/acme/${i}`,
      kind: i < official ? "official" : "aggregator",
      contentMd: "Acme content",
      jobId: job.id,
    });
    sourceIds.push(s.id);
  }
  await saveFactSheet(ctx.db, product.id, sheet(sourceIds[0]!, { citeAll: f.citeAll }), { jobId: job.id });
  for (const role of f.shots ?? [
    "screenshot:home:desktop",
    "screenshot:pricing:desktop",
    "screenshot:home:mobile",
    "screenshot:pricing:mobile",
  ])
    await media(product.id, null, role, "screenshot");

  const go = await ensureGoSlug(ctx.db, product);
  const article = await createArticle(ctx.db, {
    type: "review",
    productId: product.id,
    title: "Acme review",
    slug: "acme-review",
  });
  for (const role of f.graphics ?? ["og", "pricing_card"]) await media(product.id, article.id, role, "graphic");
  const images = [await media(product.id, article.id, "screenshot:home:desktop:framed", "graphic")];
  await addArticleVersion(ctx.db, article.id, {
    blocks: blocks(sourceIds[0]!, go.slug, images, f.dims),
    overallScore: 7.5,
    factCheck: factCheck(f.verdicts ?? ["supported", "supported"]),
    qaScorecard: scorecard(),
    jobId: job.id,
  });
  await setJobLinks(ctx.db, job.id, { articleId: article.id });

  const { step } = await startStep(ctx.db, job.id, "qa_gates", {});
  await finishStep(ctx.db, step.id, { status: "succeeded" });
  await transitionArticle(ctx.db, article.id, "in_review");
  await setJobStatus(ctx.db, job.id, "succeeded");
  // Shift creation back so the step finished `minutesToReview` after submission.
  await ctx.db
    .update(reviewJobs)
    .set({ createdAt: sql`now() - make_interval(mins => ${f.minutesToReview ?? 12})` })
    .where(eq(reviewJobs.id, job.id));
  await ctx.db.insert(costLedger).values({
    jobId: job.id,
    provider: "anthropic",
    model: "claude-opus-5-5",
    operation: "messages",
    units: "1000",
    unitType: "tokens",
    costUsd: String(f.costUsd ?? 1.8),
  });
  return { product, job, article, goSlug: go.slug };
}

const byId = (r: JobAcceptance, id: string) => r.criteria.find((c) => c.id === id)!;

describe("evaluateJobAcceptance (SRS §8)", () => {
  it("passes every stored-data criterion for a complete quick review", async () => {
    const { job } = await reviewJob();
    const r = (await evaluateJobAcceptance(ctx.db, job.id))!;
    for (const id of [
      "1.timing",
      "1.pricing_citations",
      "1.sources",
      "1.screenshots",
      "1.rubric",
      "1.graphics",
      "1.fact_check",
      "5.cost",
    ])
      expect(byId(r, id).status, `${id}: ${byId(r, id).detail}`).toBe("pass");
    expect(byId(r, "1.timing").evidence?.minutes).toBeGreaterThanOrEqual(11.9);
    expect(byId(r, "2.published").status).toBe("n/a");
    expect(byId(r, "3.golink").status).toBe("n/a");
    expect(byId(r, "4.clicks_lighthouse").status).toBe("n/a");
    expect(byId(r, "6.rerun").status).toBe("n/a");
    expect(r.summary.fail).toBe(0);
    expect(r.articleStatus).toBe("in_review");
  });

  it("fails timing, citations, sources, screenshots, graphics, fact-check and cost when they miss", async () => {
    const { job } = await reviewJob({
      minutesToReview: 45,
      citeAll: false,
      sources: { official: 6, thirdParty: 1 },
      shots: ["screenshot:home:desktop"],
      graphics: ["og"],
      verdicts: ["supported", "unsupported"],
      costUsd: 6.2,
    });
    const r = (await evaluateJobAcceptance(ctx.db, job.id))!;
    expect(byId(r, "1.timing").status).toBe("fail");
    expect(byId(r, "1.pricing_citations")).toMatchObject({ status: "fail" });
    expect(byId(r, "1.pricing_citations").detail).toContain("pricing.freeTrialDays");
    expect(byId(r, "1.sources").status).toBe("fail");
    expect(byId(r, "1.screenshots").detail).toContain("screenshot:pricing:desktop");
    expect(byId(r, "1.screenshots").status).toBe("fail");
    expect(byId(r, "1.graphics").detail).toContain("pricing card");
    expect(byId(r, "1.fact_check").status).toBe("fail");
    expect(byId(r, "5.cost").status).toBe("fail");
  });

  it("warns for missing mobile screenshots, outdated claims, odd rubric sizes and a full review over target", async () => {
    const { job } = await reviewJob({
      preset: "full_review",
      shots: ["screenshot:home:desktop", "screenshot:pricing:desktop"],
      verdicts: ["supported", "outdated"],
      dims: 3,
      costUsd: 14,
    });
    const r = (await evaluateJobAcceptance(ctx.db, job.id))!;
    expect(byId(r, "1.screenshots").status).toBe("warn");
    expect(byId(r, "1.fact_check").status).toBe("warn");
    expect(byId(r, "1.rubric").status).toBe("warn");
    expect(byId(r, "5.cost")).toMatchObject({ status: "warn" });
  });

  it("fails timing when qa_gates never finished on a finished job", async () => {
    const { job } = await reviewJob();
    await ctx.db.execute(sql`delete from job_steps where job_id = ${job.id}`);
    const r = (await evaluateJobAcceptance(ctx.db, job.id))!;
    expect(byId(r, "1.timing").status).toBe("fail");
  });

  it("checks the published version's go-links, structured data and AI disclosure (§8 #2)", async () => {
    const { job, article } = await reviewJob();
    await transitionArticle(ctx.db, article.id, "approved");
    await publishArticle(ctx.db, article.id);
    let r = (await evaluateJobAcceptance(ctx.db, job.id))!;
    expect(byId(r, "2.published").status).toBe("pass");
    expect(byId(r, "2.published").evidence?.goSlugs).toEqual(["acme"]);

    await setSetting(ctx.db, "editorial.aiDisclosure", " ");
    r = (await evaluateJobAcceptance(ctx.db, job.id))!;
    expect(byId(r, "2.published")).toMatchObject({ status: "fail" });
    expect(byId(r, "2.published").detail).toContain("aiDisclosure");
  });

  it("re-run research: passes with a diff and one product/article, fails on a duplicate review (§8 #6)", async () => {
    const { job, product } = await reviewJob();
    const rerun = await createReviewJob(ctx.db, { preset: "refresh", input: {}, productId: product.id });
    const [first] = await ctx.db.select().from(factSheets).where(eq(factSheets.productId, product.id));
    const data = { ...first!.data, name: "Acme 2" };
    await saveFactSheet(ctx.db, product.id, data, { jobId: rerun.id });
    let r = (await evaluateJobAcceptance(ctx.db, rerun.id))!;
    expect(byId(r, "6.rerun")).toMatchObject({ status: "pass" });
    expect(byId(r, "6.rerun").evidence?.changedFields).toContain("name");
    expect(byId(r, "1.review")).toBeUndefined();

    // A second English review row for the same product is a duplicate.
    await ctx.db
      .insert(articles)
      .values({ type: "review", slug: "acme-review-2", title: "Dup", productId: product.id });
    r = (await evaluateJobAcceptance(ctx.db, job.id))!;
    expect(byId(r, "6.rerun").status).toBe("fail");
    expect(byId(r, "6.rerun").detail).toContain("more than one review");

    // A fact sheet saved without a diff fails the diff part.
    await ctx.db.update(factSheets).set({ diffFromPrevious: null }).where(eq(factSheets.createdByJobId, rerun.id));
    r = (await evaluateJobAcceptance(ctx.db, rerun.id))!;
    expect(byId(r, "6.rerun").detail).toContain("has no diff");
  });

  it("marks criterion 1 n/a for non-review presets and returns null for unknown jobs", async () => {
    const { product } = await reviewJob();
    const cmp = await createReviewJob(ctx.db, { preset: "comparison", input: {}, productId: product.id });
    const r = (await evaluateJobAcceptance(ctx.db, cmp.id))!;
    expect(byId(r, "1.review").status).toBe("n/a");
    expect(byId(r, "5.cost").status).toBe("n/a");
    expect(await evaluateJobAcceptance(ctx.db, uuid())).toBeNull();
  });

  it("lists finished review jobs newest first with product and article", async () => {
    const { job } = await reviewJob();
    await createReviewJob(ctx.db, { preset: "quick_review", input: {} }); // queued: not listed
    const rows = await listAcceptanceCandidates(ctx.db, { limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId: job.id,
      productName: "Acme",
      articleTitle: "Acme review",
      articleStatus: "in_review",
    });
    expect((await ctx.db.select().from(products)).length).toBe(1);
  });

  it("collects go-slugs from CTA blocks and inline marks", () => {
    const sid = uuid();
    expect(goSlugsInBlocks(blocks(sid, "acme", []))).toEqual(["acme"]);
    expect(
      goSlugsInBlocks([
        {
          id: "l",
          type: "list",
          ordered: false,
          items: [[{ text: "x", marks: [{ type: "golink", slug: "b", placement: "list" }] }]],
        },
        {
          id: "f",
          type: "faq",
          items: [{ question: "q", answer: [{ text: "y", marks: [{ type: "golink", slug: "c", placement: "faq" }] }] }],
        },
      ]),
    ).toEqual(["b", "c"]);
  });
});
