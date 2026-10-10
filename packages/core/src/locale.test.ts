import type { QaScorecard } from "@repo/content";
import { articles, categories, eq, products } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addArticleVersion,
  createArticle,
  createDeal,
  ensureGoSlug,
  findArticleTranslation,
  findOrCreateProduct,
  getArticleTranslations,
  getCategoryBySlug,
  getLiveArticleIdBySlug,
  getPublishedArticleBySlug,
  getReviewedProductBySlug,
  listActiveDeals,
  listCategoriesWithCounts,
  listPublishedArticles,
  listPublishedReviews,
  listReviewedProducts,
  publishArticle,
  publishedSitemapEntries,
  searchPublishedReviews,
  searchSite,
  transitionArticle,
} from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());

const passing: QaScorecard = { hardGatesPassed: true, checks: [], computedAt: new Date().toISOString() };

async function publish(input: {
  productId: string;
  slug: string;
  title: string;
  locale: string;
  body: string;
  translationOfId?: string;
}) {
  const a = await createArticle(ctx.db, {
    type: "review",
    productId: input.productId,
    title: input.title,
    slug: input.slug,
    locale: input.locale,
  });
  if (input.translationOfId) {
    await ctx.db.update(articles).set({ translationOfId: input.translationOfId }).where(eq(articles.id, a.id));
  }
  await addArticleVersion(ctx.db, a.id, {
    blocks: [
      { id: "v", type: "verdict", score: 8, summary: input.body, bestFor: [], notFor: [] },
      { id: "p", type: "paragraph", children: [{ text: input.body, marks: [] }] },
    ],
    overallScore: 8,
    qaScorecard: passing,
  });
  await transitionArticle(ctx.db, a.id, "in_review");
  await transitionArticle(ctx.db, a.id, "approved");
  await publishArticle(ctx.db, a.id, { ignoreCap: true });
  return a;
}

let en: { id: string };
let de: { id: string };
let productId: string;

beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
  const [cat] = await ctx.db.select().from(categories).where(eq(categories.slug, "productivity"));
  await ctx.db
    .update(categories)
    .set({ translations: { de: { name: "Produktivität", description: "Werkzeuge für bessere Arbeit" } } })
    .where(eq(categories.id, cat!.id));
  const { product } = await findOrCreateProduct(ctx.db, {
    name: "Notion",
    websiteUrl: "notion.so",
    categoryId: cat!.id,
  });
  productId = product.id;
  await ctx.db
    .update(products)
    .set({ tagline: "Connected workspace", translations: { de: { tagline: "Vernetzter Arbeitsbereich" } } })
    .where(eq(products.id, product.id));
  await ensureGoSlug(ctx.db, product);
  en = await publish({
    productId,
    slug: "notion-review",
    title: "Notion review",
    locale: "en",
    body: "Notion pricing starts at ten dollars for teams.",
  });
  de = await publish({
    productId,
    slug: "notion-test",
    title: "Notion im Test",
    locale: "de",
    body: "Die Preise von Notion beginnen bei zehn Dollar für Teams.",
    translationOfId: en.id,
  });
});

describe("public reads per locale (phase 3)", () => {
  it("lists only the requested locale, English by default", async () => {
    expect((await listPublishedReviews(ctx.db)).map((r) => r.slug)).toEqual(["notion-review"]);
    const german = await listPublishedReviews(ctx.db, { locale: "de" });
    expect(german.map((r) => r.slug)).toEqual(["notion-test"]);
    expect(german[0]).toMatchObject({
      locale: "de",
      categoryName: "Produktivität",
      productTagline: "Vernetzter Arbeitsbereich",
    });
    expect((await listPublishedArticles(ctx.db, { locale: "de" })).map((r) => r.slug)).toEqual(["notion-test"]);
    expect((await searchPublishedReviews(ctx.db, "notion", 10, "de")).map((r) => r.slug)).toEqual(["notion-test"]);
  });

  it("localises categories and counts reviews per locale", async () => {
    const enCats = await listCategoriesWithCounts(ctx.db);
    const deCats = await listCategoriesWithCounts(ctx.db, { locale: "de" });
    expect(enCats.find((c) => c.slug === "productivity")).toMatchObject({ name: "Productivity", reviews: 1 });
    expect(deCats.find((c) => c.slug === "productivity")).toMatchObject({ name: "Produktivität", reviews: 1 });
    expect((await getCategoryBySlug(ctx.db, "productivity", "de"))?.description).toBe("Werkzeuge für bessere Arbeit");
    // Categories without a German override fall back to English.
    expect(deCats.find((c) => c.slug === "hosting")?.name).toBe(enCats.find((c) => c.slug === "hosting")?.name);
  });

  it("loads an article by slug within its locale only", async () => {
    expect(await getPublishedArticleBySlug(ctx.db, "notion-test")).toBeNull();
    const data = await getPublishedArticleBySlug(ctx.db, "notion-test", "review", "de");
    expect(data?.article.id).toBe(de.id);
    expect(data?.category?.name).toBe("Produktivität");
    expect(data?.product?.tagline).toBe("Vernetzter Arbeitsbereich");
    expect(await getLiveArticleIdBySlug(ctx.db, "notion-test", "de")).toBe(de.id);
    expect(await getLiveArticleIdBySlug(ctx.db, "notion-test")).toBeNull();
  });

  it("finds translations in both directions for hreflang and the switcher", async () => {
    const fromEn = await getArticleTranslations(ctx.db, en.id);
    expect(fromEn.map((t) => [t.locale, t.path])).toEqual([
      ["de", "/de/reviews/notion-test"],
      ["en", "/reviews/notion-review"],
    ]);
    expect(await getArticleTranslations(ctx.db, de.id)).toEqual(fromEn);
    expect(
      await findArticleTranslation(ctx.db, { type: "review", slug: "notion-review", fromLocale: "en", toLocale: "de" }),
    ).toMatchObject({ slug: "notion-test" });
    // An unpublished translation is not offered.
    await ctx.db.update(articles).set({ status: "archived" }).where(eq(articles.id, de.id));
    expect((await getArticleTranslations(ctx.db, en.id)).map((t) => t.locale)).toEqual(["en"]);
  });

  it("groups sitemap rows by source article", async () => {
    expect(await publishedSitemapEntries(ctx.db)).toHaveLength(1);
    const rows = await publishedSitemapEntries(ctx.db, { locales: ["en", "de"] });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.groupId))).toEqual(new Set([en.id]));
  });

  it("searches with the locale's text-search configuration", async () => {
    // German stemming: "Preis" matches "Preise"; the English article is never returned for de.
    expect((await searchSite(ctx.db, { q: "Preis", locale: "de" })).map((h) => h.slug)).toEqual(["notion-test"]);
    expect((await searchSite(ctx.db, { q: "pricing" })).map((h) => h.slug)).toEqual(["notion-review"]);
    expect(await searchSite(ctx.db, { q: "pricing", locale: "de" })).toEqual([]);
    const [hit] = await searchSite(ctx.db, { q: "notion", locale: "de" });
    expect(hit).toMatchObject({ slug: "notion-test", categoryName: "Produktivität" });
  });

  it("lists reviewed products and deals per locale", async () => {
    expect((await listReviewedProducts(ctx.db, { locale: "de" }))[0]).toMatchObject({
      reviewSlug: "notion-test",
      tagline: "Vernetzter Arbeitsbereich",
    });
    expect((await getReviewedProductBySlug(ctx.db, "notion", "de"))?.reviewSlug).toBe("notion-test");
    await createDeal(ctx.db, { productId, title: "20% off", discountText: "20% off" });
    expect((await listActiveDeals(ctx.db)).map((d) => d.reviewSlug)).toEqual(["notion-review"]);
    expect((await listActiveDeals(ctx.db, { locale: "de" })).map((d) => d.reviewSlug)).toEqual(["notion-test"]);
  });
});
