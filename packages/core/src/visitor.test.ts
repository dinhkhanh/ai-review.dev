import { factSheetSchema, type QaScorecard } from "@repo/content";
import { articles, eq, newsletterSubscribers, sql } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addArticleVersion,
  backfillSearchText,
  buildSearchText,
  confirmNewsletter,
  createArticle,
  createDeal,
  dealSuggestions,
  dealsForProduct,
  ensureGoSlug,
  findOrCreateProduct,
  helpfulVoteCounts,
  listActiveDeals,
  publishArticle,
  rateLimit,
  recordHelpfulVote,
  saveFactSheet,
  searchSite,
  subscribeNewsletter,
  suggestDealsFromFactSheet,
  transitionArticle,
  unsubscribeNewsletter,
  updateDeal,
  verifyTurnstile,
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

async function publishedReview(name: string, url: string, body: string) {
  const { product } = await findOrCreateProduct(ctx.db, { name, websiteUrl: url });
  await ensureGoSlug(ctx.db, product);
  const a = await createArticle(ctx.db, {
    type: "review",
    productId: product.id,
    title: `${name} review`,
    slug: `${product.slug}-review`,
  });
  await addArticleVersion(ctx.db, a.id, {
    blocks: [
      { id: "v", type: "verdict", score: 8, summary: `${name} verdict`, bestFor: [], notFor: [] },
      { id: "h", type: "heading", level: 2, text: "Pricing" },
      { id: "p", type: "paragraph", children: [{ text: body, marks: [] }] },
    ],
    overallScore: 8,
    qaScorecard: passing,
  });
  await transitionArticle(ctx.db, a.id, "in_review");
  await transitionArticle(ctx.db, a.id, "approved");
  await publishArticle(ctx.db, a.id, { ignoreCap: true });
  return { product, article: a };
}

describe("site search (FR-WEB-7)", () => {
  it("builds search text from names, headings, verdict and body", () => {
    const text = buildSearchText({
      productName: "Notion",
      categoryName: "Productivity",
      blocks: [
        { id: "h", type: "heading", level: 2, text: "Pricing" },
        { id: "v", type: "verdict", score: 8, summary: "Great wiki", bestFor: [], notFor: [] },
      ],
    });
    expect(text).toContain("Notion");
    expect(text).toContain("Productivity");
    expect(text).toContain("Great wiki");
  });

  it("finds live articles by body text and product name, ranks, filters and skips drafts", async () => {
    await publishedReview("Notion", "https://notion.so", "Collaborative wiki with databases and kanban boards.");
    await publishedReview("Plausible", "https://plausible.io", "Cookieless website analytics.");
    const { product: draft } = await findOrCreateProduct(ctx.db, { name: "Coda", websiteUrl: "https://coda.io" });
    await createArticle(ctx.db, { type: "review", productId: draft.id, title: "Coda review", slug: "coda-review" });

    const kanban = await searchSite(ctx.db, { q: "kanban boards" });
    expect(kanban.map((h) => h.slug)).toEqual(["notion-review"]);
    expect(kanban[0]!.type).toBe("review");
    expect((await searchSite(ctx.db, { q: "plaus" })).map((h) => h.slug)).toEqual(["plausible-review"]);
    expect(await searchSite(ctx.db, { q: "coda" })).toHaveLength(0);
    expect(await searchSite(ctx.db, { q: "analytics", type: "comparison" })).toHaveLength(0);
    expect(await searchSite(ctx.db, { q: "analytics", categorySlug: "hosting" })).toHaveLength(0);
    expect(await searchSite(ctx.db, { q: "   " })).toEqual([]);
    // Odd input never throws (websearch_to_tsquery parses anything).
    expect(await searchSite(ctx.db, { q: `"unbalanced -( or %_` })).toBeInstanceOf(Array);
  });

  it("backfills search text for live articles published before search existed", async () => {
    const { article } = await publishedReview("Notion", "https://notion.so", "Wiki and docs.");
    await ctx.db.update(articles).set({ searchText: null }).where(eq(articles.id, article.id));
    expect(await backfillSearchText(ctx.db)).toBe(1);
    expect(await backfillSearchText(ctx.db)).toBe(0);
  });

  it("the full-text branch can use the GIN index", async () => {
    const plan = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      return tx.execute<{ "QUERY PLAN": string }>(
        sql`explain select id from articles where search_tsv @@ websearch_to_tsquery('english', 'wiki')`,
      );
    });
    expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain("articles_search_tsv_idx");
  });
});

describe("deals (FR-WEB-8)", () => {
  it("derives deterministic drafts from fact-sheet terms and program promo codes", () => {
    const s = dealSuggestions({
      productName: "Acme",
      freeTrialDays: 14,
      freePlan: true,
      moneyBackDays: 30,
      programs: [
        { id: "p1", notes: "Exclusive: 20% off with coupon: AIREVIEW20" },
        { id: "p2", notes: "no codes here" },
      ],
    });
    expect(s.map((x) => x.discountText)).toEqual(["14-day free trial", "Free plan", "30-day money-back", "20% off"]);
    expect(s[3]).toMatchObject({ code: "AIREVIEW20", source: "program", programId: "p1" });
    expect(dealSuggestions({ productName: "X", freeTrialDays: 0 })).toEqual([]);
  });

  it("lists active, in-window deals for products with live reviews only", async () => {
    const { product } = await publishedReview("Notion", "https://notion.so", "Wiki.");
    const { product: unreviewed } = await findOrCreateProduct(ctx.db, { name: "Coda", websiteUrl: "coda.io" });
    const now = new Date("2026-10-10T00:00:00Z");
    const live = await createDeal(ctx.db, { productId: product.id, title: "Notion: 20% off", code: "SAVE20" });
    await createDeal(ctx.db, { productId: product.id, title: "Expired", endsAt: new Date("2026-01-01") });
    await createDeal(ctx.db, { productId: product.id, title: "Inactive", active: false });
    await createDeal(ctx.db, { productId: unreviewed.id, title: "No review" });
    const active = await listActiveDeals(ctx.db, { now });
    expect(active.map((d) => d.title)).toEqual(["Notion: 20% off"]);
    expect(active[0]).toMatchObject({ goSlug: "notion", reviewSlug: "notion-review", code: "SAVE20" });
    expect((await dealsForProduct(ctx.db, product.id, now)).map((d) => d.id)).toEqual([live.id]);
    await expect(
      updateDeal(ctx.db, live.id, { startsAt: new Date("2026-02-01"), endsAt: new Date("2026-01-01") }),
    ).rejects.toThrow(/end after/);
  });

  it("suggests inactive drafts from the fact sheet once", async () => {
    const { product } = await findOrCreateProduct(ctx.db, { name: "Notion", websiteUrl: "notion.so" });
    await saveFactSheet(
      ctx.db,
      product.id,
      factSheetSchema.parse({
        name: "Notion",
        website: "https://notion.so",
        pricing: {
          tiers: { value: [], citations: [] },
          freePlan: { value: true, citations: [] },
          freeTrialDays: { value: 7, citations: [] },
        },
      }),
    );
    const first = await suggestDealsFromFactSheet(ctx.db, product.id);
    expect(first.map((d) => [d.discountText, d.active, d.source])).toEqual([
      ["7-day free trial", false, "fact_sheet"],
      ["Free plan", false, "fact_sheet"],
    ]);
    expect(await suggestDealsFromFactSheet(ctx.db, product.id)).toHaveLength(0);
  });
});

describe("helpful votes (FR-WEB-10)", () => {
  it("keeps one vote per visitor per day and lets them change it", async () => {
    const { article } = await publishedReview("Notion", "https://notion.so", "Wiki.");
    const day1 = new Date("2026-10-10T10:00:00Z");
    await recordHelpfulVote(ctx.db, { articleId: article.id, helpful: true, ipHash: "a", now: day1 });
    await recordHelpfulVote(ctx.db, { articleId: article.id, helpful: false, ipHash: "a", now: day1 });
    await recordHelpfulVote(ctx.db, { articleId: article.id, helpful: true, ipHash: "b", now: day1 });
    await recordHelpfulVote(ctx.db, { articleId: article.id, helpful: true, ipHash: "a", now: new Date("2026-10-11") });
    expect(await helpfulVoteCounts(ctx.db, article.id)).toEqual({ helpful: 2, notHelpful: 1 });
    expect(await helpfulVoteCounts(ctx.db, article.id, new Date("2026-10-11"))).toEqual({ helpful: 1, notHelpful: 0 });
  });
});

describe("newsletter double opt-in (FR-API-3)", () => {
  const env = { resendApiKey: "re_test", emailFrom: "AI Review <hi@ai-review.dev>", siteUrl: "https://ai-review.dev" };

  it("emails a confirmation link, rate-limits repeats, confirms and unsubscribes", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const t0 = new Date("2026-10-10T10:00:00Z");
    expect(
      await subscribeNewsletter(ctx.db, { email: " Reader@Example.com " }, { env, now: t0, fetch: fetchMock }),
    ).toBe("sent");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.to).toEqual(["reader@example.com"]);
    expect(body.text).toContain("https://ai-review.dev/newsletter/confirm?token=");
    expect(await subscribeNewsletter(ctx.db, { email: "reader@example.com" }, { env, now: t0, fetch: fetchMock })).toBe(
      "cooldown",
    );

    const [row] = await ctx.db.select().from(newsletterSubscribers);
    expect(row!.confirmedAt).toBeNull();
    expect(await confirmNewsletter(ctx.db, "nope", t0)).toBe(false);
    expect(await confirmNewsletter(ctx.db, row!.token!, t0)).toBe(true);
    expect(await subscribeNewsletter(ctx.db, { email: "reader@example.com" }, { env, now: t0, fetch: fetchMock })).toBe(
      "already_confirmed",
    );
    expect(await unsubscribeNewsletter(ctx.db, row!.token!)).toBe(true);
    expect(await unsubscribeNewsletter(ctx.db, "nope")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects stale confirmation links and invalid addresses", async () => {
    const t0 = new Date("2026-10-01T00:00:00Z");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await subscribeNewsletter(ctx.db, { email: "late@example.com" }, { env, now: t0, fetch: fetchMock });
    const [row] = await ctx.db.select().from(newsletterSubscribers);
    expect(await confirmNewsletter(ctx.db, row!.token!, new Date("2026-10-20T00:00:00Z"))).toBe(false);
    await expect(subscribeNewsletter(ctx.db, { email: "not-an-email" }, { env })).rejects.toThrow(/valid email/);
  });
});

describe("visitor guard (NFR-7)", () => {
  it("skips Turnstile without a secret and verifies tokens with one", async () => {
    expect(await verifyTurnstile(null)).toEqual({ ok: true, skipped: true });
    expect((await verifyTurnstile(null, { secret: "s" })).ok).toBe(false);
    const ok = vi.fn(async () => Response.json({ success: true }));
    expect(await verifyTurnstile("tok", { secret: "s", fetch: ok })).toEqual({ ok: true, skipped: false });
    const bad = vi.fn(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }));
    expect(await verifyTurnstile("tok", { secret: "s", fetch: bad })).toMatchObject({
      ok: false,
      error: "invalid-input-response",
    });
  });

  it("limits hits per fixed window in memory and through Upstash REST", async () => {
    const now = 1_000_000;
    const key = `test-${Math.random()}`;
    const hits = [];
    for (let i = 0; i < 3; i++) hits.push(await rateLimit(key, { limit: 2, windowSeconds: 60, now }));
    expect(hits.map((h) => h.allowed)).toEqual([true, true, false]);
    expect((await rateLimit(key, { limit: 2, windowSeconds: 60, now: now + 60_000 })).allowed).toBe(true);

    const upstash = vi.fn(async () => Response.json([{ result: 5 }, { result: 1 }]));
    const r = await rateLimit("k", {
      limit: 4,
      windowSeconds: 60,
      now,
      redis: { url: "https://r", token: "t" },
      fetch: upstash,
    });
    expect(r).toMatchObject({ allowed: false, count: 5 });
    const failing = vi.fn(async () => {
      throw new Error("down");
    });
    expect(
      (
        await rateLimit(`f-${Math.random()}`, {
          limit: 1,
          windowSeconds: 60,
          redis: { url: "u", token: "t" },
          fetch: failing,
        })
      ).allowed,
    ).toBe(true);
  });
});
