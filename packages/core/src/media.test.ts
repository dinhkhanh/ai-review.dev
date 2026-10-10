import type { ArticleBody } from "@repo/content";
import { articles, eq, mediaAssets, products } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addArticleVersion,
  articleCount,
  createArticle,
  findOrCreateProduct,
  getCurrentVersion,
  getMediaAsset,
  insertImageIntoArticle,
  insertionIndex,
  listMediaChildren,
  mediaUsage,
  searchMedia,
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

async function asset(values: Partial<typeof mediaAssets.$inferInsert> & { storageKey: string }) {
  const [row] = await ctx.db
    .insert(mediaAssets)
    .values({ kind: "screenshot", origin: "captured", mimeType: "image/webp", storage: "db", ...values })
    .returning();
  return row!;
}

const intro: ArticleBody = [
  { id: "verdict", type: "verdict", score: 8, summary: "Good", bestFor: [], notFor: [] },
  { id: "cta-verdict", type: "cta", goSlug: "acme", placement: "verdict", label: "Visit" },
  { id: "intro-0", type: "paragraph", children: [{ text: "Hello", marks: [] }] },
  { id: "intro-1", type: "paragraph", children: [{ text: "World", marks: [] }] },
  { id: "sec-features-h", type: "heading", level: 2, text: "Features" },
];

describe("media library", () => {
  it("searches by alt, role, key and product, filters and pages", async () => {
    const { product } = await findOrCreateProduct(ctx.db, { name: "Acme", websiteUrl: "https://acme.dev" });
    const shot = await asset({
      storageKey: "p/a.webp",
      role: "screenshot:home:desktop",
      alt: "Acme home",
      productId: product.id,
    });
    await asset({ storageKey: "p/b.webp", kind: "graphic", origin: "templated", role: "og" });
    await asset({
      storageKey: "p/c.webp",
      kind: "graphic",
      origin: "templated",
      role: "screenshot:home:desktop:processed",
      parentAssetId: shot.id,
    });

    expect((await searchMedia(ctx.db, { q: "acme" })).rows.map((r) => r.storageKey)).toEqual(["p/a.webp"]);
    expect((await searchMedia(ctx.db, { q: "home" })).total).toBe(2);
    expect((await searchMedia(ctx.db, { kind: "graphic", missingAlt: true })).total).toBe(2);
    expect((await searchMedia(ctx.db, { origin: "captured" })).rows[0]!.productName).toBe("Acme");
    expect((await searchMedia(ctx.db, { q: "100%_" })).total).toBe(0);
    const page = await searchMedia(ctx.db, { limit: 1, offset: 1 });
    expect([page.rows.length, page.total]).toEqual([1, 3]);
    expect((await getMediaAsset(ctx.db, shot.id))!.productName).toBe("Acme");
    expect((await listMediaChildren(ctx.db, shot.id)).map((c) => c.storageKey)).toEqual(["p/c.webp"]);
  });

  it("reports usage in current/published versions, OG images and logos, and inserts images", async () => {
    const { product } = await findOrCreateProduct(ctx.db, { name: "Acme", websiteUrl: "https://acme.dev" });
    const shot = await asset({ storageKey: "u/a.webp" });
    const og = await asset({ storageKey: "u/og.webp", kind: "graphic", origin: "templated" });
    const logo = await asset({ storageKey: "u/logo.webp", kind: "logo", origin: "vendor" });
    const unused = await asset({ storageKey: "u/x.webp" });
    await ctx.db.update(products).set({ logoAssetId: logo.id }).where(eq(products.id, product.id));
    const article = await createArticle(ctx.db, {
      type: "review",
      productId: product.id,
      title: "Acme review",
      slug: "acme",
    });
    const v1 = await addArticleVersion(ctx.db, article.id, {
      blocks: [...intro, { id: "shot", type: "image", assetId: shot.id }],
      seo: {
        title: "t",
        metaDescription: "m",
        primaryKeyword: "k",
        secondaryKeywords: [],
        intent: "review",
        ogImageAssetId: og.id,
        internalLinks: [],
      },
    });
    // v1 is live; v2 (current) drops the screenshot.
    await ctx.db.update(articles).set({ publishedVersionId: v1.id }).where(eq(articles.id, article.id));
    await addArticleVersion(ctx.db, article.id, { blocks: intro, seo: v1.seo });

    const usage = await mediaUsage(ctx.db, [shot.id, og.id, logo.id, unused.id]);
    expect(usage.get(shot.id)).toEqual([
      expect.objectContaining({ via: "image", articleId: article.id, inCurrent: false, inPublished: true }),
    ]);
    expect(usage.get(og.id)![0]).toMatchObject({ via: "og", inCurrent: true, inPublished: true });
    expect(usage.get(logo.id)![0]).toMatchObject({ via: "logo", productName: "Acme" });
    expect(articleCount(usage.get(shot.id))).toBe(1);
    expect(articleCount(usage.get(logo.id))).toBe(0);
    expect(usage.get(unused.id)).toEqual([]);

    const v3 = await insertImageIntoArticle(ctx.db, {
      articleId: article.id,
      assetId: unused.id,
      caption: " Illustration ",
    });
    expect(v3.blocks.map((b) => b.id)).toEqual([
      "verdict",
      "cta-verdict",
      "intro-0",
      "intro-1",
      `img-${unused.id.slice(0, 8)}`,
      "sec-features-h",
    ]);
    expect(v3.blocks[4]).toMatchObject({ type: "image", caption: "Illustration" });
    expect((await getCurrentVersion(ctx.db, article.id))!.id).toBe(v3.id);
    await expect(insertImageIntoArticle(ctx.db, { articleId: article.id, assetId: unused.id })).rejects.toThrow(
      /already/,
    );
  });

  it("places images after the verdict CTA or first when there is no intro", () => {
    expect(insertionIndex(intro.slice(0, 2))).toBe(2);
    expect(insertionIndex([intro[0]!])).toBe(1);
    expect(insertionIndex([intro[4]!])).toBe(0);
  });
});
