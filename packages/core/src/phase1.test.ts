import { resolveGoLink } from "@repo/affiliate";
import { factSheetSchema, type QaScorecard } from "@repo/content";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { sql } from "@repo/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activatePromptVersion,
  addArticleVersion,
  claimNextQueuedJob,
  createArticle,
  createLink,
  createReviewJob,
  diffFactSheets,
  ensureGoSlug,
  findOrCreateProduct,
  getActivePromptOverride,
  getArticle,
  latestStepRuns,
  listVersions,
  loadArticleRenderData,
  loadGoLinkTable,
  markStepsStale,
  publishArticle,
  replaceChunks,
  rollbackToVersion,
  saveFactSheet,
  savePromptVersion,
  searchChunks,
  setSetting,
  sourceRefs,
  startStep,
  finishStep,
  transitionArticle,
  updateProgram,
  upsertDiscoveredProgram,
  upsertSource,
  listSources,
  getPublishedArticleBySlug,
  listPublishedReviews,
  purgeOldClicks,
  recordClick,
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

const passing: QaScorecard = { hardGatesPassed: true, checks: [], computedAt: new Date().toISOString() };

async function product() {
  const { product } = await findOrCreateProduct(ctx.db, { name: "Notion", websiteUrl: "https://www.notion.so" });
  return product;
}

describe("products + go-slugs", () => {
  it("findOrCreateProduct never duplicates a domain, and every product gets a go-slug", async () => {
    const a = await findOrCreateProduct(ctx.db, { name: "Notion", websiteUrl: "notion.so" });
    const b = await findOrCreateProduct(ctx.db, { name: "Notion Calendar", websiteUrl: "https://calendar.notion.so" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.product.id).toBe(a.product.id);
    const go = await ensureGoSlug(ctx.db, a.product);
    expect(go).toMatchObject({ slug: "notion", fallbackUrl: "https://notion.so" });
    expect((await ensureGoSlug(ctx.db, a.product)).slug).toBe("notion");
  });
});

describe("sources, refs and retrieval", () => {
  it("upserts by URL, numbers sources S1..Sn and finds chunks by keyword", async () => {
    const p = await product();
    const s1 = await upsertSource(ctx.db, {
      productId: p.id,
      url: "https://notion.so/pricing",
      kind: "official",
      contentMd: "Plus costs $10",
    });
    const again = await upsertSource(ctx.db, {
      productId: p.id,
      url: "https://notion.so/pricing",
      kind: "official",
      contentMd: "Plus costs $12",
    });
    expect(again.id).toBe(s1.id);
    expect(again.contentMd).toBe("Plus costs $12");
    const s2 = await upsertSource(ctx.db, { productId: p.id, url: "https://reddit.com/r/notion", kind: "community" });
    const refs = sourceRefs(await listSources(ctx.db, p.id));
    expect(refs.ref(s1.id)).toBe("S1");
    expect(refs.id("s2")).toBe(s2.id);
    expect(refs.id("S9")).toBeNull();

    await replaceChunks(ctx.db, s1, [
      { text: "The Plus plan costs $12 per seat per month billed annually.", tokenCount: 14 },
      { text: "Enterprise adds SAML single sign-on and audit logs.", tokenCount: 10 },
    ]);
    const hits = await searchChunks(ctx.db, p.id, { query: "SAML sign-on" });
    expect(hits[0]!.text).toContain("SAML");
    // Long claims match on shared terms, best match first.
    const claim = await searchChunks(ctx.db, p.id, {
      query: "Our notes: Enterprise includes SAML single sign-on for larger teams.",
    });
    expect(claim[0]!.text).toContain("Enterprise");
    expect(await searchChunks(ctx.db, p.id, { query: "the and of" })).toEqual([]);
  });
});

describe("fact sheets", () => {
  it("versions sheets and diffs values, not citations", async () => {
    const p = await product();
    const base = {
      name: "Notion",
      website: "https://notion.so",
      pricing: { tiers: { value: [{ name: "Plus", price: 10, period: "month" as const }], citations: [] } },
      features: [{ value: "Docs", citations: [] }],
    };
    const v1 = await saveFactSheet(ctx.db, p.id, factSheetSchema.parse(base));
    expect(v1.version).toBe(1);
    expect(v1.diffFromPrevious).toEqual([]);
    const v2 = await saveFactSheet(
      ctx.db,
      p.id,
      factSheetSchema.parse({
        ...base,
        pricing: { tiers: { value: [{ name: "Plus", price: 12, period: "month" }], citations: [{ sourceId: p.id }] } },
      }),
    );
    expect(v2.version).toBe(2);
    expect(v2.diffFromPrevious).toEqual([{ path: "pricing.tiers[0].price", before: 10, after: 12 }]);
    expect(diffFactSheets(v2.data, v2.data)).toEqual([]);
  });
});

describe("articles", () => {
  it("versions content, rolls back append-only, and enforces the state machine and gates", async () => {
    const p = await product();
    const article = await createArticle(ctx.db, {
      type: "review",
      productId: p.id,
      title: "Notion Review",
      slug: "Notion Review",
    });
    expect(article.slug).toBe("notion-review");
    const dup = await createArticle(ctx.db, { type: "review", productId: null, title: "x", slug: "notion-review" });
    expect(dup.slug).toBe("notion-review-2");

    const v1 = await addArticleVersion(ctx.db, article.id, {
      blocks: [{ id: "h", type: "heading", level: 2, text: "One" }],
      changeNote: "write",
    });
    await addArticleVersion(ctx.db, article.id, {
      blocks: [{ id: "h", type: "heading", level: 2, text: "Two" }],
      qaScorecard: passing,
    });
    const rolled = await rollbackToVersion(ctx.db, article.id, v1.id);
    expect(rolled.version).toBe(3);
    expect((await listVersions(ctx.db, article.id)).map((v) => v.version)).toEqual([3, 2, 1]);

    await expect(transitionArticle(ctx.db, article.id, "approved")).rejects.toThrow(/draft to approved/);
    await transitionArticle(ctx.db, article.id, "in_review");
    await transitionArticle(ctx.db, article.id, "approved");
    // v3 (rollback of v1) has no scorecard -> gates not passed.
    await expect(publishArticle(ctx.db, article.id)).rejects.toThrow(/quality gates/);
    await addArticleVersion(ctx.db, article.id, { blocks: rolled.blocks, qaScorecard: passing });
    const published = await publishArticle(ctx.db, article.id);
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeInstanceOf(Date);
    await expect(transitionArticle(ctx.db, article.id, "scheduled", { scheduledFor: new Date() })).rejects.toThrow();
  });

  it("applies the daily publishing cap to first publications only", async () => {
    await setSetting(ctx.db, "publishing.dailyCap", 1);
    const p = await product();
    const make = async (slug: string) => {
      const a = await createArticle(ctx.db, { type: "review", productId: p.id, title: slug, slug });
      await addArticleVersion(ctx.db, a.id, { blocks: [], qaScorecard: passing });
      await transitionArticle(ctx.db, a.id, "in_review");
      await transitionArticle(ctx.db, a.id, "approved");
      return a;
    };
    const a = await make("a");
    const b = await make("b");
    await publishArticle(ctx.db, a.id);
    await expect(publishArticle(ctx.db, b.id)).rejects.toThrow(/cap/);
    // Republishing an edit of an already-published article is not capped.
    await transitionArticle(ctx.db, a.id, "in_review");
    await transitionArticle(ctx.db, a.id, "approved");
    await expect(publishArticle(ctx.db, a.id)).resolves.toMatchObject({ status: "published" });
  });

  it("loads render data and lists only published reviews", async () => {
    const p = await product();
    await ensureGoSlug(ctx.db, p);
    const src = await upsertSource(ctx.db, { productId: p.id, url: "https://notion.so/pricing", kind: "official" });
    const a = await createArticle(ctx.db, {
      type: "review",
      productId: p.id,
      title: "Notion Review",
      slug: "notion-review",
    });
    await addArticleVersion(ctx.db, a.id, {
      blocks: [
        {
          id: "p",
          type: "paragraph",
          children: [{ text: "", marks: [{ type: "citation", citation: { sourceId: src.id } }] }],
        },
      ],
      qaScorecard: passing,
    });
    const data = await loadArticleRenderData(ctx.db, a.id);
    expect(data).toMatchObject({ goSlug: "notion", product: { name: "Notion" }, author: { slug: "editor-in-chief" } });
    expect(data!.sources.map((s) => s.id)).toEqual([src.id]);
    expect(await getPublishedArticleBySlug(ctx.db, "notion-review")).toBeNull();
    expect(await listPublishedReviews(ctx.db)).toHaveLength(0);
    await transitionArticle(ctx.db, a.id, "in_review");
    await transitionArticle(ctx.db, a.id, "approved");
    await publishArticle(ctx.db, a.id);
    expect((await getPublishedArticleBySlug(ctx.db, "notion-review"))?.article.id).toBe(a.id);
    expect(await listPublishedReviews(ctx.db)).toHaveLength(1);
    expect((await getArticle(ctx.db, a.id))!.status).toBe("published");
  });
});

describe("affiliate programs and go-link table (acceptance criterion 3)", () => {
  it("falls back to the vendor URL, then switches to the affiliate link once active, without redeploying", async () => {
    const p = await product();
    await ensureGoSlug(ctx.db, p);
    let table = await loadGoLinkTable(ctx.db, "notion");
    expect(resolveGoLink(table!, { placement: "verdict" })).toMatchObject({ fallback: true });

    const program = await upsertDiscoveredProgram(ctx.db, {
      productId: p.id,
      network: "partnerstack",
      name: "Notion Partner Program",
      status: "found",
      commissionModel: "recurring_percent",
      commissionValue: 20,
      redirectPolicy: "allowed",
    });
    await createLink(ctx.db, {
      productId: p.id,
      programId: program.id,
      label: "Default",
      destinationUrl: "https://notion.grsm.io/x",
      status: "active",
    });
    table = await loadGoLinkTable(ctx.db, "notion");
    expect(resolveGoLink(table!).fallback).toBe(true); // program not active yet

    const active = await updateProgram(ctx.db, program.id, { status: "active" });
    expect(active.approvedAt).toBeInstanceOf(Date);
    table = await loadGoLinkTable(ctx.db, "notion");
    const r = resolveGoLink(table!, { articleSlug: "notion-review", placement: "verdict" });
    expect(r.fallback).toBe(false);
    expect(r.url).toBe("https://notion.grsm.io/x?ps_xid=notion-review--verdict");

    // Re-discovery refreshes terms but keeps the admin's status.
    const again = await upsertDiscoveredProgram(ctx.db, {
      productId: p.id,
      network: "partnerstack",
      name: "Notion Partners",
      status: "found",
      commissionValue: 25,
    });
    expect(again.status).toBe("active");
    expect(again.commissionValue).toBe("25.00");
    expect(await loadGoLinkTable(ctx.db, "missing")).toBeNull();
  });
});

describe("jobs", () => {
  it("claims queued jobs once and marks downstream steps stale", async () => {
    const job = await createReviewJob(ctx.db, { preset: "quick_review", input: {} });
    expect(await claimNextQueuedJob(ctx.db)).toBe(job.id);
    expect(await claimNextQueuedJob(ctx.db)).toBeNull();
    const a = await startStep(ctx.db, job.id, "write", {});
    await finishStep(ctx.db, a.step.id, { status: "succeeded", output: { ok: 1 } });
    await markStepsStale(ctx.db, job.id, ["write", "qa_gates"]);
    expect((await latestStepRuns(ctx.db, job.id)).get("write")!.status).toBe("stale");
  });
});

describe("prompt overrides", () => {
  it("saves numbered versions and activates one at a time", async () => {
    expect(await getActivePromptOverride(ctx.db, "write")).toBeNull();
    const a = await savePromptVersion(ctx.db, { key: "write", body: "A", activate: true });
    const b = await savePromptVersion(ctx.db, { key: "write", body: "B" });
    expect([a.version, b.version]).toEqual([1001, 1002]);
    expect((await getActivePromptOverride(ctx.db, "write"))!.body).toBe("A");
    await activatePromptVersion(ctx.db, "write", 1002);
    expect((await getActivePromptOverride(ctx.db, "write"))!.body).toBe("B");
    await activatePromptVersion(ctx.db, "write", null);
    expect(await getActivePromptOverride(ctx.db, "write")).toBeNull();
    await expect(activatePromptVersion(ctx.db, "write", 7)).rejects.toThrow();
  });
});

describe("click retention", () => {
  it("purges raw clicks older than 13 months", async () => {
    const base = { goSlug: "x", linkId: null, isBot: false, fallback: true };
    await recordClick(ctx.db, base);
    await ctx.db.execute(sql`update clicks set ts = now() - interval '14 months'`);
    await recordClick(ctx.db, base);
    expect(await purgeOldClicks(ctx.db)).toBe(1);
  });
});
