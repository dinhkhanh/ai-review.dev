import { resolveGoLink } from "@repo/affiliate";
import { affiliateLinks, auditLog, conversions, eq } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  articleIdForClick,
  completeExperiment,
  createArticle,
  createLink,
  createProgram,
  deleteLink,
  ensureGoSlug,
  epcPValue,
  findOrCreateProduct,
  getExperimentReport,
  importConversions,
  listExperiments,
  loadGoLinkTable,
  localeFromPath,
  normalCdf,
  recordClick,
  setSetting,
  startExperiment,
  stopExperiment,
  twoProportionPValue,
} from "./index";

describe("experiment statistics (FR-AFF-13)", () => {
  it("normal CDF matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 4);
  });
  it("two-proportion test", () => {
    // 10% vs 5% on 1000 clicks each is clearly significant; 10% vs 9.5% is not.
    expect(twoProportionPValue(100, 1000, 50, 1000)!).toBeLessThan(0.001);
    expect(twoProportionPValue(100, 1000, 95, 1000)!).toBeGreaterThan(0.5);
    expect(twoProportionPValue(0, 100, 0, 100)).toBe(1);
    expect(twoProportionPValue(1, 0, 1, 10)).toBeNull();
  });
  it("EPC test uses the per-click earnings variance", () => {
    const a = { clicks: 1000, commission: 100 * 20, commissionSq: 100 * 400 };
    const b = { clicks: 1000, commission: 50 * 20, commissionSq: 50 * 400 };
    expect(epcPValue(a, b)!).toBeLessThan(0.001);
    expect(epcPValue(a, a)!).toBeCloseTo(1, 6);
    expect(epcPValue({ clicks: 1, commission: 0, commissionSq: 0 }, b)).toBeNull();
    expect(
      epcPValue({ clicks: 10, commission: 0, commissionSq: 0 }, { clicks: 10, commission: 0, commissionSq: 0 }),
    ).toBe(1);
  });
});

describe("localeFromPath", () => {
  it("reads the locale prefix of the referring page", () => {
    expect(localeFromPath("/de/reviews/acme")).toBe("de");
    expect(localeFromPath("/DE")).toBe("de");
    expect(localeFromPath("/reviews/acme")).toBe("en");
    expect(localeFromPath("/en/reviews/acme")).toBe("en");
    expect(localeFromPath("/desk")).toBe("en");
    expect(localeFromPath(null)).toBe("en");
  });
});

describe("experiments with a database (FR-AFF-13)", () => {
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
      redirectPolicy: "allowed",
    });
    const a = await createLink(ctx.db, {
      productId: product.id,
      programId: program.id,
      label: "Trial page",
      destinationUrl: "https://acme.dev/trial",
      status: "active",
      priority: 10,
    });
    const b = await createLink(ctx.db, {
      productId: product.id,
      programId: program.id,
      label: "Pricing page",
      destinationUrl: "https://acme.dev/pricing",
      status: "active",
      priority: 20,
    });
    return { product, article, program, a, b };
  }

  async function clicksFor(goSlug: string, articleId: string, linkId: string, experimentId: string, n: number) {
    for (let i = 0; i < n; i++) {
      await recordClick(ctx.db, { goSlug, linkId, articleId, experimentId, isBot: false, fallback: false });
    }
  }

  it("validates the links it is started with", async () => {
    const { product, a, b, program } = await fixture();
    await expect(startExperiment(ctx.db, { productId: product.id, name: "x", linkIds: [a.id] })).rejects.toThrow(
      /at least two/,
    );
    const de = await createLink(ctx.db, {
      productId: product.id,
      programId: program.id,
      label: "DE",
      destinationUrl: "https://acme.dev/de",
      status: "active",
      region: "DE",
    });
    await expect(startExperiment(ctx.db, { productId: product.id, name: "x", linkIds: [a.id, de.id] })).rejects.toThrow(
      /same region/,
    );
    const paused = await createLink(ctx.db, {
      productId: product.id,
      label: "Paused",
      destinationUrl: "https://acme.dev/p",
      status: "paused",
    });
    await expect(
      startExperiment(ctx.db, { productId: product.id, name: "x", linkIds: [a.id, paused.id] }),
    ).rejects.toThrow(/not active/);
    // A better-ranked link outside the test would take its traffic.
    const top = await createLink(ctx.db, {
      productId: product.id,
      label: "Top",
      destinationUrl: "https://acme.dev/top",
      status: "active",
      priority: 1,
    });
    await expect(startExperiment(ctx.db, { productId: product.id, name: "x", linkIds: [a.id, b.id] })).rejects.toThrow(
      /“Top” has priority 1/,
    );
    await deleteLink(ctx.db, top.id);
    await expect(
      startExperiment(ctx.db, { productId: product.id, name: "x", linkIds: [a.id, b.id], weights: { [a.id]: 0 } }),
    ).rejects.toThrow(/Weights/);
  });

  it("splits traffic, tags clicks and SubIDs, attributes conversions and calls a winner", async () => {
    const { product, article, a, b } = await fixture();
    const exp = await startExperiment(ctx.db, {
      productId: product.id,
      name: "Trial vs pricing",
      linkIds: [a.id, b.id],
      weights: { [a.id]: 50, [b.id]: 50 },
      userId: "u1",
    });
    const links = await ctx.db.select().from(affiliateLinks).where(eq(affiliateLinks.experimentId, exp.id));
    expect(links.map((l) => [l.priority, l.weight])).toEqual([
      [10, 50],
      [10, 50],
    ]);
    await expect(
      startExperiment(ctx.db, { productId: product.id, name: "again", linkIds: [a.id, b.id] }),
    ).rejects.toThrow(/already in a running experiment/);
    await expect(deleteLink(ctx.db, a.id)).rejects.toThrow(/Stop or complete/);

    const table = (await loadGoLinkTable(ctx.db, product.slug))!;
    expect(table.links.every((l) => l.experimentId === exp.id)).toBe(true);
    const ra = resolveGoLink(table, { articleSlug: "acme-review", placement: "hero", random: () => 0.1 });
    const rb = resolveGoLink(table, { articleSlug: "acme-review", placement: "hero", random: () => 0.9 });
    expect(new Set([ra.linkId, rb.linkId])).toEqual(new Set([a.id, b.id]));
    expect(ra.experimentId).toBe(exp.id);
    expect(ra.subId).toMatch(/^acme-review--hero--v[0-9a-f]{6}$/);

    // Collecting: below the minimum clicks per variant.
    await setSetting(ctx.db, "affiliate.experiments", { minClicksPerVariant: 100, confidence: 0.95 });
    await clicksFor(product.slug, article.id, a.id, exp.id, 40);
    let report = await getExperimentReport(ctx.db, exp.id);
    expect(report.verdict.state).toBe("collecting");
    expect(report.verdict.message).toMatch(/Not enough data yet/);
    expect(report.verdict.winnerLinkId).toBeNull();

    await clicksFor(product.slug, article.id, a.id, exp.id, 160);
    await clicksFor(product.slug, article.id, b.id, exp.id, 200);
    await recordClick(ctx.db, {
      goSlug: product.slug,
      linkId: a.id,
      experimentId: exp.id,
      isBot: true,
      fallback: false,
    });
    const subA = ra.linkId === a.id ? ra.subId : rb.subId;
    const subB = ra.linkId === b.id ? ra.subId : rb.subId;
    const base = {
      network: "partnerstack" as const,
      amount: 100,
      currency: "USD",
      program: null,
      status: "approved" as const,
    };
    const now = new Date();
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => ({ ...base, subId: subA, orderId: `a${i}`, commission: 20 })),
      ...Array.from({ length: 4 }, (_, i) => ({ ...base, subId: subB, orderId: `b${i}`, commission: 20 })),
      // Network reports may upper-case SubIDs.
      { ...base, subId: subB.toUpperCase(), orderId: "b-upper", commission: 20, status: "reversed" as const },
    ].map((r) => ({ ...r, date: now.toISOString() }));
    await importConversions(ctx.db, rows, { source: "csv", network: "partnerstack" });
    const stored = await ctx.db.select().from(conversions);
    expect(stored.filter((c) => c.linkId === a.id)).toHaveLength(30);
    expect(stored.filter((c) => c.linkId === b.id)).toHaveLength(5);
    expect(stored.every((c) => c.articleId === article.id && c.placement === "hero")).toBe(true);

    report = await getExperimentReport(ctx.db, exp.id);
    const va = report.variants.find((v) => v.linkId === a.id)!;
    const vb = report.variants.find((v) => v.linkId === b.id)!;
    expect(va).toMatchObject({
      clicks: 200,
      conversions: 30,
      commission: 600,
      conversionRate: 0.15,
      epc: 3,
      trafficShare: 0.5,
    });
    expect(vb).toMatchObject({ clicks: 200, conversions: 4, commission: 80, epc: 0.4 });
    expect(vb.pEpc!).toBeLessThan(0.05);
    expect(vb.pConversionRate!).toBeLessThan(0.05);
    expect(report.verdict).toMatchObject({ state: "winner", winnerLinkId: a.id, leaderLinkId: a.id });

    await expect(completeExperiment(ctx.db, exp.id, { winnerLinkId: b.id })).rejects.toThrow(/does not support/);
    const done = await completeExperiment(ctx.db, exp.id, { winnerLinkId: a.id, userId: "u1" });
    expect(done.paused).toEqual([b.id]);
    const after = await ctx.db.select().from(affiliateLinks).where(eq(affiliateLinks.experimentId, exp.id));
    expect(after.find((l) => l.id === a.id)!.status).toBe("active");
    expect(after.find((l) => l.id === b.id)!.status).toBe("paused");
    // Finished tests no longer tag clicks.
    expect((await loadGoLinkTable(ctx.db, product.slug))!.links.every((l) => l.experimentId === null)).toBe(true);
    const actions = (await ctx.db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["experiment.start", "experiment.complete"]));
    expect((await listExperiments(ctx.db, { status: "completed" }))[0]).toMatchObject({
      productName: "Acme",
      variants: 2,
    });
  });

  it("attributes clicks to the article in the page's locale", async () => {
    const { product, article } = await fixture();
    const de = await createArticle(ctx.db, {
      type: "review",
      productId: product.id,
      title: "Acme Test",
      slug: "acme-review",
      locale: "de",
    });
    expect(await articleIdForClick(ctx.db, "acme-review", "de")).toBe(de.id);
    expect(await articleIdForClick(ctx.db, "acme-review", "en")).toBe(article.id);
    expect(await articleIdForClick(ctx.db, "nope", "en")).toBeNull();
  });

  it("stops without a winner and allows an explicit inconclusive promotion", async () => {
    const { product, a, b } = await fixture();
    const exp = await startExperiment(ctx.db, { productId: product.id, name: "t", linkIds: [a.id, b.id] });
    expect((await listExperiments(ctx.db, { productId: product.id, status: "running" })).length).toBe(1);
    await stopExperiment(ctx.db, exp.id);
    await expect(stopExperiment(ctx.db, exp.id)).rejects.toThrow(/not running/);
    const report = await getExperimentReport(ctx.db, exp.id);
    expect(report.verdict.state).toBe("collecting");
    expect(report.variants.map((v) => v.clicks)).toEqual([0, 0]);
    // A stopped experiment's links can join a new one.
    const again = await startExperiment(ctx.db, { productId: product.id, name: "t2", linkIds: [a.id, b.id] });
    const done = await completeExperiment(ctx.db, again.id, { winnerLinkId: b.id, allowInconclusive: true });
    expect(done.paused).toEqual([a.id]);
    await expect(completeExperiment(ctx.db, again.id, { winnerLinkId: b.id })).rejects.toThrow(/already completed/);
  });
});
