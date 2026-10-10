import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { affiliateLinks, eq, notifications, pageViewsDaily } from "@repo/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  articleFunnel,
  articleMargins,
  analyticsTotals,
  articleRefFromPath,
  autoDetectMapping,
  checkLink,
  costsBy,
  createArticle,
  createLink,
  createProgram,
  ensureGoSlug,
  exportRows,
  findOrCreateProduct,
  importConversions,
  invalidateGoLinkCache,
  importPlausiblePageViews,
  isoWeek,
  loadGoLinkTable,
  parseConversionDate,
  parseConversionsCsv,
  parseCsv,
  parseDateRange,
  placementCtr,
  recordClick,
  remindStaleApplications,
  revenueBy,
  runLinkHealthChecks,
  setSetting,
  syncNetworkConversions,
  toCsv,
  updateProgram,
} from "./index";

/** Fake fetch serving a map of URL -> [status, location?]. */
function fakeWeb(routes: Record<string, [number, string?]>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const route = routes[url];
    if (!route) throw new Error(`ENOTFOUND ${url}`);
    const [status, location] = route;
    return new Response(null, { status, headers: location ? { location } : {} });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("CSV parsing (FR-AFF-11)", () => {
  it("handles quotes, escaped quotes, newlines in fields, CRLF, BOM and ; delimiters", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",2\n\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["multi\nline", "2"],
    ]);
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("auto-detects a typical network export mapping", () => {
    expect(
      autoDetectMapping([
        "Transaction ID",
        "Date",
        "Advertiser",
        "Click Ref",
        "Sale Amount",
        "Commission",
        "Status",
        "Currency",
      ]),
    ).toEqual({
      orderId: "Transaction ID",
      date: "Date",
      program: "Advertiser",
      subId: "Click Ref",
      amount: "Sale Amount",
      commission: "Commission",
      status: "Status",
      currency: "Currency",
    });
  });
  it("parses dates in common formats", () => {
    expect(parseConversionDate("2026-10-01")?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(parseConversionDate("2026-10-01 13:05")?.toISOString()).toBe("2026-10-01T13:05:00.000Z");
    expect(parseConversionDate("25/09/2026")?.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(parseConversionDate("09/25/2026")?.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(parseConversionDate("31/02/2026")).toBeNull();
    expect(parseConversionDate("nope")).toBeNull();
  });
  it("produces rows and per-row errors", () => {
    const csv = [
      "Order ID,Date,Program,Sub ID,Sale,Commission,Status,Currency",
      'A-1,2026-10-01,Notion,notion-review--hero,"1,000.00",$30.00,approved,usd',
      "A-2,2026-10-02,Notion,,10,2,Reversed,",
      ",2026-10-02,Notion,,10,2,approved,",
      "A-4,yesterday,Notion,,10,2,approved,",
    ].join("\n");
    const parsed = parseConversionsCsv(csv, { network: "partnerstack" });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      network: "partnerstack",
      orderId: "A-1",
      subId: "notion-review--hero",
      amount: 1000,
      commission: 30,
      currency: "USD",
      status: "approved",
    });
    expect(parsed.rows[1]).toMatchObject({ status: "reversed", subId: null, currency: "USD" });
    expect(parsed.errors.map((e) => e.row)).toEqual([3, 4]);
  });
});

describe("helpers", () => {
  it("maps article paths and ISO weeks", () => {
    expect(articleRefFromPath("/reviews/notion-review")).toEqual({ type: "review", slug: "notion-review" });
    expect(articleRefFromPath("/compare/a-vs-b?x=1")).toEqual({ type: "comparison", slug: "a-vs-b" });
    expect(articleRefFromPath("/best/crm/")).toEqual({ type: "best_of", slug: "crm" });
    expect(articleRefFromPath("/about")).toBeNull();
    expect(isoWeek(new Date("2026-10-10T12:00:00Z"))).toBe("2026-W41");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
  it("serialises CSV safely and parses date ranges", () => {
    expect(toCsv([{ a: 'x,"y"', b: "=HYPERLINK()", c: -5, d: null }], ["a", "b", "c", "d"])).toBe(
      'a,b,c,d\r\n"x,""y""",\'=HYPERLINK(),-5,\r\n',
    );
    const r = parseDateRange("2026-10-01", "2026-10-09");
    expect(r.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    const d = parseDateRange(null, "bad", new Date("2026-10-10T08:00:00Z"));
    expect(d.to.toISOString()).toBe("2026-10-11T00:00:00.000Z");
    expect(d.from.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });
});

describe("invalidateGoLinkCache", () => {
  it("deletes go-link keys through the Upstash REST API", async () => {
    const calls: Array<{ url: string; auth: string }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string>).Authorization! });
      return new Response('{"result":2}');
    }) as unknown as typeof fetch;
    const env = { UPSTASH_REDIS_REST_URL: "https://x.upstash.io/", UPSTASH_REDIS_REST_TOKEN: "tok" };
    expect(await invalidateGoLinkCache(["acme", "b c"], env, impl)).toBe(true);
    expect(calls).toEqual([
      { url: "https://x.upstash.io/del/golink%3Av1%3Aacme/golink%3Av1%3Ab%20c", auth: "Bearer tok" },
    ]);
    expect(await invalidateGoLinkCache(["acme"], {}, impl)).toBe(false);
  });
});

describe("checkLink (FR-AFF-10)", () => {
  it("follows redirects to the product domain and flags a dropped tracking param as a warning", async () => {
    const { impl } = fakeWeb({
      "https://partner.net/r/1?via=ai": [302, "https://www.acme.dev/?ref=x"],
      "https://www.acme.dev/?ref=x": [200],
    });
    const r = await checkLink("https://partner.net/r/1?via=ai", {
      fetch: impl,
      productDomain: "acme.dev",
      linkFormat: { kind: "query_param", param: "via", value: "ai" },
    });
    expect(r.ok).toBe(true);
    expect(r.finalUrl).toBe("https://www.acme.dev/?ref=x");
    expect(r.problems).toEqual([expect.objectContaining({ code: "missing_tracking", fatal: false })]);
  });
  it("retries HEAD with GET and classifies 404, 403, loops, domain changes and private hosts", async () => {
    const web = fakeWeb({ "https://acme.dev/gone": [404] });
    const gone = await checkLink("https://acme.dev/gone", { fetch: web.impl, productDomain: "acme.dev" });
    expect(gone.ok).toBe(false);
    expect(gone.problems[0]!.code).toBe("http_error");
    expect(web.calls).toEqual(["HEAD https://acme.dev/gone", "GET https://acme.dev/gone"]);

    const blocked = await checkLink("https://acme.dev/", { fetch: fakeWeb({ "https://acme.dev/": [403] }).impl });
    expect(blocked.ok).toBe(true);
    expect(blocked.problems[0]!.code).toBe("bot_protection");

    const loop = await checkLink("https://a.dev/1", {
      fetch: fakeWeb({ "https://a.dev/1": [301, "/2"], "https://a.dev/2": [302, "https://a.dev/1"] }).impl,
    });
    expect(loop.problems[0]!.code).toBe("redirect_loop");

    const moved = await checkLink("https://acme.dev/", {
      fetch: fakeWeb({ "https://acme.dev/": [301, "https://other.io/"], "https://other.io/": [200] }).impl,
      productDomain: "acme.dev",
    });
    expect(moved.problems.map((p) => p.code)).toEqual(["domain_changed"]);
    const rebrand = await checkLink("https://notion.so/", {
      fetch: fakeWeb({ "https://notion.so/": [301, "https://www.notion.com/"], "https://www.notion.com/": [200] }).impl,
      productDomain: "notion.so",
    });
    expect(rebrand.ok).toBe(true);

    const ssrf = await checkLink("https://acme.dev/", {
      fetch: fakeWeb({ "https://acme.dev/": [302, "http://127.0.0.1/admin"] }).impl,
    });
    expect(ssrf.problems[0]!.code).toBe("blocked_host");

    const many: Record<string, [number, string?]> = {};
    for (let i = 0; i < 12; i++) many[`https://acme.dev/${i}`] = [302, `https://acme.dev/${i + 1}`];
    const tooMany = await checkLink("https://acme.dev/0", { fetch: fakeWeb(many).impl });
    expect(tooMany.problems[0]!.code).toBe("too_many_redirects");

    const down = await checkLink("https://down.dev/", { fetch: fakeWeb({}).impl });
    expect(down.problems[0]!.code).toBe("network_error");
  });
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
    await ensureGoSlug(ctx.db, product);
    const article = await createArticle(ctx.db, {
      type: "review",
      productId: product.id,
      title: "Acme review",
      slug: "acme-review",
    });
    const program = await createProgram(ctx.db, {
      productId: product.id,
      network: "partnerstack",
      name: "Acme Partners",
      status: "active",
    });
    return { product, article, program };
  }

  it("fills the catch-all config from settings (FR-AFF-5)", async () => {
    const { product } = await fixture();
    expect((await loadGoLinkTable(ctx.db, product.slug))!.catchAll).toBeNull();
    await setSetting(ctx.db, "affiliate.catchAllFallback", {
      enabled: true,
      network: "skimlinks",
      publisherId: " 9X9 ",
    });
    expect((await loadGoLinkTable(ctx.db, product.slug))!.catchAll).toEqual({
      network: "skimlinks",
      publisherId: "9X9",
    });
    await setSetting(ctx.db, "affiliate.catchAllFallback", {
      enabled: false,
      network: "skimlinks",
      publisherId: "9X9",
    });
    expect((await loadGoLinkTable(ctx.db, product.slug))!.catchAll).toBeNull();
  });

  it("imports conversions with attribution, upserts re-imports, and counts unmatched rows", async () => {
    const { product, article } = await fixture();
    const base = { network: "partnerstack" as const, amount: 100, currency: "USD", program: null };
    const first = await importConversions(
      ctx.db,
      [
        {
          ...base,
          date: "2026-10-01T00:00:00Z",
          subId: "acme-review--pricing",
          orderId: "o1",
          commission: 30,
          status: "pending",
        },
        {
          ...base,
          date: "2026-10-02T00:00:00Z",
          subId: null,
          orderId: "o2",
          commission: 5,
          status: "approved",
          program: "Acme",
        },
        {
          ...base,
          date: "2026-10-03T00:00:00Z",
          subId: "unknown--x",
          orderId: "o3",
          commission: 1,
          status: "approved",
        },
      ],
      { source: "csv", network: "partnerstack", filename: "export.csv" },
    );
    expect(first).toMatchObject({ rows: 3, inserted: 3, updated: 0, unmatched: 1 });
    const second = await importConversions(
      ctx.db,
      [{ ...base, date: "2026-10-01T00:00:00Z", subId: null, orderId: "o1", commission: 30, status: "approved" }],
      { source: "api:partnerstack", network: "partnerstack" },
    );
    expect(second).toMatchObject({ inserted: 0, updated: 1, unmatched: 1 });
    const rows = await exportRows(ctx.db, "conversions", parseDateRange("2026-09-01", "2026-10-31"));
    const o1 = rows.rows.find((r) => r.external_order_id === "o1")!;
    // Attribution from the first import survives a re-import without a SubID.
    expect(o1).toMatchObject({
      article_slug: "acme-review",
      placement: "pricing",
      status: "approved",
      program: "Acme Partners",
    });
    const o2 = rows.rows.find((r) => r.external_order_id === "o2")!;
    expect(o2).toMatchObject({ product: "Acme", program: "Acme Partners", article_slug: null });

    // Revenue and funnel.
    await recordClick(ctx.db, {
      goSlug: product.slug,
      linkId: null,
      articleId: article.id,
      placement: "pricing",
      isBot: false,
      fallback: false,
    });
    const range = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2027-01-01T00:00:00Z") };
    const clickRange = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const byArticle = await revenueBy(ctx.db, "article", range);
    expect(byArticle.find((r) => r.key === article.id)).toMatchObject({
      label: "Acme review",
      revenueUsd: 30,
      conversions: 1,
    });
    const byProduct = await revenueBy(ctx.db, "product", range);
    expect(byProduct.find((r) => r.key === product.id)).toMatchObject({ label: "Acme", revenueUsd: 35 });
    const byPlacement = await revenueBy(ctx.db, "placement", clickRange);
    expect(byPlacement.find((r) => r.key === "pricing")!.clicks).toBe(1);
    expect((await revenueBy(ctx.db, "month", range))[0]!.key).toBe("2026-10");

    await ctx.db.insert(pageViewsDaily).values({
      day: new Date().toISOString().slice(0, 10),
      path: "/reviews/acme-review",
      articleId: article.id,
      pageviews: 40,
      visitors: 30,
    });
    const funnel = await articleFunnel(ctx.db, clickRange);
    expect(funnel[0]).toMatchObject({ articleId: article.id, pageviews: 40, clicks: 1, ctr: 1 / 40 });
    const ctr = await placementCtr(ctx.db, clickRange);
    expect(ctr.pageviews).toBe(40);
    expect(ctr.placements.find((p) => p.placement === "pricing")!.clicks).toBe(1);
    const totals = await analyticsTotals(ctx.db, clickRange);
    expect(totals).toMatchObject({ clicks: 1, pageviews: 40 });
    const margins = await articleMargins(ctx.db);
    expect(margins.margins.find((m) => m.articleId === article.id)).toMatchObject({ revenueUsd: 30, marginUsd: 30 });
    expect(await costsBy(ctx.db, "step", range)).toEqual([]);
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.event, "conversions.imported"));
    expect(notes).toHaveLength(2);
  });

  it("syncs configured networks and reports failures per network", async () => {
    await fixture();
    const impl = (async (url: string) =>
      String(url).includes("partnerstack")
        ? new Response(
            JSON.stringify({
              data: {
                has_more: false,
                items: [{ key: "r1", amount: 500, status: "approved", created_at: Date.now() }],
              },
            }),
          )
        : new Response("down", { status: 500 })) as unknown as typeof fetch;
    const results = await syncNetworkConversions(ctx.db, {
      from: new Date(Date.now() - 86_400_000),
      to: new Date(),
      env: { PARTNERSTACK_API_KEY: "k", AWIN_API_TOKEN: "t", AWIN_PUBLISHER_ID: "1" },
      fetch: impl,
    });
    expect(results).toEqual([
      expect.objectContaining({ network: "partnerstack", ok: true, rows: 1 }),
      expect.objectContaining({ network: "awin", ok: false }),
    ]);
  });

  it("imports Plausible page views and links article pages", async () => {
    const { article } = await fixture();
    const impl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(body).toMatchObject({ site_id: "ai-review.dev", dimensions: ["time:day", "event:page"] });
      return new Response(
        JSON.stringify({
          results: [
            { dimensions: ["2026-10-01", "/reviews/acme-review"], metrics: [12, 9] },
            { dimensions: ["2026-10-01", "/"], metrics: [50, 40] },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const opts = {
      apiKey: "k",
      siteId: "ai-review.dev",
      from: new Date("2026-10-01"),
      to: new Date("2026-10-02"),
      fetch: impl,
    };
    expect(await importPlausiblePageViews(ctx.db, opts)).toEqual({ rows: 2, articlePages: 1 });
    await importPlausiblePageViews(ctx.db, opts); // idempotent
    const rows = await ctx.db.select().from(pageViewsDaily);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.path === "/reviews/acme-review")).toMatchObject({ articleId: article.id, pageviews: 12 });
  });

  it("pauses a link after consecutive failures, notifies once a day, and keeps broken links broken", async () => {
    const { product } = await fixture();
    const link = await createLink(ctx.db, {
      productId: product.id,
      label: "Main",
      destinationUrl: "https://acme.dev/gone",
      status: "active",
    });
    const bad = fakeWeb({ "https://acme.dev/gone": [404] }).impl;
    const now = new Date("2026-10-10T03:00:00Z");
    const r1 = await runLinkHealthChecks(ctx.db, { fetch: bad, now, env: {} });
    expect(r1).toMatchObject({ checked: 1, failed: 1, paused: [] });
    const r2 = await runLinkHealthChecks(ctx.db, { fetch: bad, now, env: {} });
    expect(r2.paused).toEqual([link.id]);
    const [row] = await ctx.db.select().from(affiliateLinks).where(eq(affiliateLinks.id, link.id));
    expect(row).toMatchObject({ status: "broken", healthFailures: 2 });
    expect(row!.healthDetail).toContain("HTTP 404");
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.event, "link.broken"));
    expect(notes).toHaveLength(1);

    // Daily runs skip broken links; "Check now" re-checks them, and a pass doesn't re-activate.
    expect((await runLinkHealthChecks(ctx.db, { fetch: bad, now, env: {} })).checked).toBe(0);
    const good = fakeWeb({ "https://acme.dev/gone": [200] }).impl;
    await runLinkHealthChecks(ctx.db, { fetch: good, now, env: {}, linkIds: [link.id] });
    const [after] = await ctx.db.select().from(affiliateLinks).where(eq(affiliateLinks.id, link.id));
    expect(after).toMatchObject({ status: "broken", healthFailures: 0 });
    expect(after!.healthDetail).toContain("re-activate");

    await setSetting(ctx.db, "linkHealth.policy", { enabled: false, failuresBeforePause: 2 });
    expect((await runLinkHealthChecks(ctx.db, { fetch: bad, now, env: {} })).skipped).toBe(true);
  });

  it("reminds about stale applications once per week", async () => {
    const { program } = await fixture();
    await updateProgram(ctx.db, program.id, { status: "applied" });
    const later = new Date(Date.now() + 20 * 86_400_000);
    expect(await remindStaleApplications(ctx.db, { now: new Date() })).toEqual({ stale: 0, sent: 0 });
    expect(await remindStaleApplications(ctx.db, { now: later })).toEqual({ stale: 1, sent: 1 });
    expect(await remindStaleApplications(ctx.db, { now: later })).toEqual({ stale: 1, sent: 0 });
  });
});
