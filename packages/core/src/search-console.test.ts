import { randomUUID } from "node:crypto";
import { articles, eq, notifications, products, searchConsoleDaily, searchConsoleQueries } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createArticle,
  detectContentDecay,
  dismissDecay,
  evaluateDecay,
  findOrCreateProduct,
  importSearchConsole,
  listDecayingArticles,
  mergeDailyRows,
  setSetting,
  sitePathFromUrl,
  splitLocalePath,
  topQueriesForArticles,
  type SearchAnalyticsRow,
  type SearchConsoleClient,
} from "./index";

const policy = { minClickDrop: 0.3, minBaselineClicks: 20 };

describe("Search Console paths and merging (FR-MNT-3)", () => {
  it("normalises URLs to site paths and splits the locale prefix", () => {
    expect(sitePathFromUrl("https://ai-review.dev/reviews/notion-review/?utm=x#a")).toBe("/reviews/notion-review");
    expect(sitePathFromUrl("https://ai-review.dev/")).toBe("/");
    expect(sitePathFromUrl("https://ai-review.dev/de/reviews/b%C3%BCro")).toBe("/de/reviews/büro");
    expect(splitLocalePath("/de/reviews/x")).toEqual({ locale: "de", path: "/reviews/x" });
    expect(splitLocalePath("/de")).toEqual({ locale: "de", path: "/" });
    expect(splitLocalePath("/en/reviews/x")).toEqual({ locale: "en", path: "/en/reviews/x" });
    expect(splitLocalePath("/reviews/x")).toEqual({ locale: "en", path: "/reviews/x" });
  });

  it("sums duplicate URLs for one path with an impression-weighted position", () => {
    const merged = mergeDailyRows([
      { keys: ["2026-10-01", "https://ai-review.dev/reviews/a"], clicks: 3, impressions: 100, ctr: 0, position: 2 },
      { keys: ["2026-10-01", "http://ai-review.dev/reviews/a/"], clicks: 1, impressions: 300, ctr: 0, position: 6 },
    ] as SearchAnalyticsRow[]);
    expect(merged).toEqual([{ day: "2026-10-01", page: "/reviews/a", clicks: 4, impressions: 400, position: 5 }]);
  });
});

describe("evaluateDecay", () => {
  const m = (clicks: number, position: number | null = 5) => ({ clicks, impressions: clicks * 20, position });
  it("needs a baseline", () => {
    expect(evaluateDecay(m(0), m(19), policy)).toBeNull();
  });
  it("flags a click drop at the threshold and a ranking loss on its own", () => {
    expect(evaluateDecay(m(70), m(100), policy)?.reasons).toEqual(["clicks"]);
    expect(evaluateDecay(m(71), m(100), policy)).toBeNull();
    expect(evaluateDecay(m(95, 8.5), m(100, 4), policy)).toMatchObject({ reasons: ["position"], positionChange: 4.5 });
    expect(evaluateDecay(m(10, 12), m(100, 3), policy)?.reasons).toEqual(["clicks", "position"]);
  });
});

/** Fake client: answers date+page queries from `daily`, page+query from `queries`. */
function fakeClient(daily: SearchAnalyticsRow[], queries: SearchAnalyticsRow[] = []) {
  const calls: Array<{ startDate: string; endDate: string; dimensions: string[] }> = [];
  const client: SearchConsoleClient = {
    async query(input) {
      calls.push(input);
      if (input.dimensions.includes("query")) return queries;
      return daily.filter((r) => r.keys[0]! >= input.startDate && r.keys[0]! <= input.endDate);
    },
  };
  return { client, calls };
}

const row = (d: string, page: string, clicks: number, position = 4): SearchAnalyticsRow => ({
  keys: [d, `https://ai-review.dev${page}`],
  clicks,
  impressions: clicks * 20,
  position,
});

describe("with a database", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await ctx.reset();
    await seed(ctx.db);
  });

  async function fixture() {
    const { product } = await findOrCreateProduct(ctx.db, { name: "Acme", websiteUrl: "https://acme.dev" });
    const en = await createArticle(ctx.db, {
      type: "review",
      productId: product.id,
      title: "Acme review",
      slug: "acme-review",
    });
    const de = await createArticle(ctx.db, {
      type: "review",
      productId: product.id,
      title: "Acme Test",
      slug: "acme-test",
      locale: "de",
    });
    for (const a of [en, de]) {
      await ctx.db
        .update(articles)
        .set({ publishedVersionId: randomUUID(), status: "published" })
        .where(eq(articles.id, a.id));
    }
    return { product, en, de };
  }

  /** 56 days ending 2026-10-08: previous window `before` clicks/day, current window `after`. */
  function series(page: string, before: number, after: number, posBefore = 4, posAfter = 4) {
    const out: SearchAnalyticsRow[] = [];
    const end = Date.UTC(2026, 9, 8);
    for (let i = 0; i < 56; i++) {
      const d = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
      out.push(i < 28 ? row(d, page, after, posAfter) : row(d, page, before, posBefore));
    }
    return out;
  }

  it("imports daily rows, maps en and /de/ pages to articles, and replaces top queries", async () => {
    const { en, de } = await fixture();
    const { client, calls } = fakeClient(
      [
        row("2026-10-05", "/reviews/acme-review", 5),
        row("2026-10-05", "/reviews/acme-review/", 2),
        row("2026-10-05", "/de/reviews/acme-test", 3),
        row("2026-10-06", "/about", 1),
      ],
      [
        {
          keys: ["https://ai-review.dev/reviews/acme-review", "acme review"],
          clicks: 9,
          impressions: 90,
          ctr: 0,
          position: 2,
        },
        {
          keys: ["https://ai-review.dev/reviews/acme-review", "acme pricing"],
          clicks: 2,
          impressions: 80,
          ctr: 0,
          position: 6,
        },
      ],
    );
    const result = await importSearchConsole(ctx.db, client, { now: new Date("2026-10-11T12:00:00Z") });
    expect(result).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-10",
      dailyRows: 3,
      articleRows: 2,
      queryRows: 2,
      latestDay: "2026-10-06",
    });
    expect(calls[0]).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-10", dimensions: ["date", "page"] });

    const daily = await ctx.db.select().from(searchConsoleDaily);
    expect(daily.find((r) => r.page === "/reviews/acme-review")).toMatchObject({ clicks: 7, articleId: en.id });
    expect(daily.find((r) => r.page === "/de/reviews/acme-test")).toMatchObject({ clicks: 3, articleId: de.id });
    expect(daily.find((r) => r.page === "/about")?.articleId).toBeNull();

    const top = await topQueriesForArticles(ctx.db, [en.id]);
    expect(top.get(en.id)?.map((q) => q.query)).toEqual(["acme review", "acme pricing"]);

    // The next window replaces the old one; re-importing a day overwrites it.
    const second = fakeClient(
      [row("2026-10-05", "/reviews/acme-review", 1)],
      [
        {
          keys: ["https://ai-review.dev/reviews/acme-review", "acme alternatives"],
          clicks: 1,
          impressions: 5,
          ctr: 0,
          position: 9,
        },
      ],
    );
    await importSearchConsole(ctx.db, second.client, { now: new Date("2026-10-12T12:00:00Z") });
    const queries = await ctx.db.select().from(searchConsoleQueries);
    expect(queries.map((q) => q.query)).toEqual(["acme alternatives"]);
    const [again] = await ctx.db
      .select()
      .from(searchConsoleDaily)
      .where(eq(searchConsoleDaily.page, "/reviews/acme-review"));
    expect(again!.clicks).toBe(1);
  });

  it("caps backfills at 16 months and chunks requests", async () => {
    await fixture();
    const { client, calls } = fakeClient([]);
    const res = await importSearchConsole(ctx.db, client, { to: new Date("2026-10-10T00:00:00Z"), days: 10_000 });
    expect(res.from).toBe("2025-06-12");
    expect(calls.filter((c) => !c.dimensions.includes("query"))).toHaveLength(6);
  });

  it("flags decay once, notifies, pulls the refresh forward, clears after a refresh", async () => {
    const { product, en, de } = await fixture();
    await ctx.db
      .update(products)
      .set({ nextRefreshAt: new Date("2026-12-01T00:00:00Z") })
      .where(eq(products.id, product.id));
    const { client } = fakeClient([...series("/reviews/acme-review", 10, 5), ...series("/de/reviews/acme-test", 2, 2)]);
    const now = new Date("2026-10-11T06:00:00Z");
    await importSearchConsole(ctx.db, client, { now, days: 60 });

    const first = await detectContentDecay(ctx.db, { now });
    expect(first).toMatchObject({ anchorDay: "2026-10-08", flagged: [en.id], cleared: [], refreshesPulled: 1 });
    const [p] = await ctx.db.select().from(products).where(eq(products.id, product.id));
    expect(p!.nextRefreshAt!.getTime()).toBe(now.getTime());
    const list = await listDecayingArticles(ctx.db);
    expect(list).toHaveLength(1);
    expect(list[0]!.signal).toMatchObject({
      reasons: ["clicks"],
      clickChange: -0.5,
      current: { clicks: 140 },
      previous: { clicks: 280 },
    });
    expect(list[0]!.id).not.toBe(de.id);
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.event, "content.decay"));
    expect(notes).toHaveLength(1);

    // Re-running keeps the original flag date and does not notify again.
    const again = await detectContentDecay(ctx.db, { now: new Date("2026-10-12T06:00:00Z") });
    expect(again.flagged).toEqual([]);
    expect(await ctx.db.select().from(notifications).where(eq(notifications.event, "content.decay"))).toHaveLength(1);

    // A refresh (re-verification) clears it, and the page gets a window to recover.
    await ctx.db
      .update(articles)
      .set({ lastVerifiedAt: new Date("2026-10-13T00:00:00Z") })
      .where(eq(articles.id, en.id));
    const cleared = await detectContentDecay(ctx.db, { now: new Date("2026-10-14T06:00:00Z") });
    expect(cleared.cleared).toEqual([en.id]);
    const later = await detectContentDecay(ctx.db, { now: new Date("2026-10-15T06:00:00Z") });
    expect(later.flagged).toEqual([]);
  });

  it("respects dismissal, the policy switch and a missing import", async () => {
    const { en } = await fixture();
    expect((await detectContentDecay(ctx.db)).anchorDay).toBeNull();
    const { client } = fakeClient(series("/reviews/acme-review", 10, 1));
    const now = new Date("2026-10-11T06:00:00Z");
    await importSearchConsole(ctx.db, client, { now, days: 60 });

    await setSetting(ctx.db, "searchConsole.policy", {
      enabled: false,
      windowDays: 28,
      minClickDrop: 0.3,
      minBaselineClicks: 20,
      scheduleRefresh: true,
    });
    expect((await detectContentDecay(ctx.db, { now })).flagged).toEqual([]);
    await setSetting(ctx.db, "searchConsole.policy", {
      enabled: true,
      windowDays: 28,
      minClickDrop: 0.3,
      minBaselineClicks: 20,
      scheduleRefresh: false,
    });
    const run = await detectContentDecay(ctx.db, { now });
    expect(run).toMatchObject({ flagged: [en.id], refreshesPulled: 0 });

    expect(await dismissDecay(ctx.db, [en.id], now)).toBe(1);
    expect((await detectContentDecay(ctx.db, { now: new Date("2026-10-20T00:00:00Z") })).flagged).toEqual([]);
    expect((await detectContentDecay(ctx.db, { now: new Date("2026-11-20T00:00:00Z") })).flagged).toEqual([en.id]);
  });
});
