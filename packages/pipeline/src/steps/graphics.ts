import { renderOgImage, renderPricingCard, renderProsConsCard, renderScoreBadge } from "@repo/graphics";
import { getArticle, getCurrentVersion, getProduct, latestFactSheet, setVersionQa } from "@repo/core";
import { categories, eq } from "@repo/db";
import { saveImageAsset } from "@repo/media";
import { z } from "zod";
import { defineStep } from "../step";

/** graphics (FR-MED-1, FR-MED-4): OG image, pricing card, pros/cons card, score badge → storage. */
export const graphicsStep = defineStep({
  name: "graphics",
  input: z.object({ articleId: z.uuid() }),
  output: z.object({
    ogAssetId: z.string().nullable(),
    pricingCardAssetId: z.string().nullable(),
    prosConsAssetId: z.string().nullable(),
    badgeAssetId: z.string().nullable(),
  }),
  async run(ctx, input) {
    const article = await getArticle(ctx.db, input.articleId);
    const version = await getCurrentVersion(ctx.db, input.articleId);
    if (!article?.productId || !version) throw new Error("Article or version not found");
    if (!ctx.storage) {
      ctx.log("no storage configured; skipping graphics");
      return { output: { ogAssetId: null, pricingCardAssetId: null, prosConsAssetId: null, badgeAssetId: null } };
    }
    const storage = ctx.storage;
    const product = await getProduct(ctx.db, article.productId);
    const [category] = product?.categoryId
      ? await ctx.db.select().from(categories).where(eq(categories.id, product.categoryId)).limit(1)
      : [];
    const sheet = await latestFactSheet(ctx.db, article.productId);
    const score = version.overallScore ?? undefined;
    const prefix = `articles/${article.id}/graphics`;
    const save = async (png: Buffer, role: string, alt: string) =>
      (
        await saveImageAsset(ctx.db, storage, {
          bytes: png,
          kind: "graphic",
          origin: "templated",
          prefix,
          role,
          alt,
          productId: article.productId,
          articleId: article.id,
          lossless: true,
        })
      ).id;

    const og = await renderOgImage({ title: version.seo?.title ?? article.title, category: category?.name, score });
    const ogAssetId = await save(
      og.png,
      "og",
      `${article.title}${score !== undefined ? ` — scored ${score.toFixed(1)}/10` : ""}`,
    );

    const tiers = sheet?.data.pricing?.tiers.value ?? [];
    const pricingCardAssetId = tiers.length
      ? await save(
          (await renderPricingCard({ productName: product!.name, verifiedAt: sheet!.createdAt, tiers })).png,
          "pricing_card",
          `${product!.name} pricing plans as of ${sheet!.createdAt.toISOString().slice(0, 10)}`,
        )
      : null;

    const pc = version.blocks.find((b) => b.type === "pros_cons");
    const prosConsAssetId =
      pc && pc.type === "pros_cons"
        ? await save(
            (await renderProsConsCard({ productName: product!.name, pros: pc.pros, cons: pc.cons })).png,
            "pros_cons",
            `${product!.name} pros and cons`,
          )
        : null;
    const badgeAssetId =
      score !== undefined
        ? await save(
            (await renderScoreBadge({ score, productName: product!.name })).png,
            "score_badge",
            `Score ${score.toFixed(1)} out of 10`,
          )
        : null;

    if (version.seo) await setVersionQa(ctx.db, version.id, { seo: { ...version.seo, ogImageAssetId: ogAssetId } });
    return { output: { ogAssetId, pricingCardAssetId, prosConsAssetId, badgeAssetId } };
  },
});
