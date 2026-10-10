import { renderOgImage, renderPricingCard, renderProsConsCard, renderScoreBadge } from "@repo/graphics";
import { getArticle, getCurrentVersion, getProduct, latestFactSheet, listMedia, setVersionQa } from "@repo/core";
import { categories, eq } from "@repo/db";
import { saveImageAsset, saveProcessedScreenshot } from "@repo/media";
import { z } from "zod";
import { defineStep } from "../step";

/** Desktop screenshots that also get a browser-framed version (FR-MED-3). */
const FRAMED_ROLES = ["screenshot:home:desktop", "screenshot:pricing:desktop"];

/**
 * graphics (FR-MED-1, FR-MED-3, FR-MED-4): OG image, pricing card, pros/cons card, score badge and
 * browser-framed screenshots → storage. Originals are kept; framed versions link to them.
 */
export const graphicsStep = defineStep({
  name: "graphics",
  input: z.object({ articleId: z.uuid() }),
  output: z.object({
    ogAssetId: z.string().nullable(),
    pricingCardAssetId: z.string().nullable(),
    prosConsAssetId: z.string().nullable(),
    badgeAssetId: z.string().nullable(),
    framedScreenshotIds: z.array(z.string()).default([]),
  }),
  async run(ctx, input) {
    const article = await getArticle(ctx.db, input.articleId);
    const version = await getCurrentVersion(ctx.db, input.articleId);
    if (!article || !version) throw new Error("Article or version not found");
    if (!ctx.storage) {
      ctx.log("no storage configured; skipping graphics");
      return {
        output: {
          ogAssetId: null,
          pricingCardAssetId: null,
          prosConsAssetId: null,
          badgeAssetId: null,
          framedScreenshotIds: [],
        },
      };
    }
    const storage = ctx.storage;
    // Comparisons and lists (FR-CON-8) get only an OG image; product cards belong to reviews.
    if (article.type !== "review" || !article.productId) {
      const [listCategory] = article.categoryId
        ? await ctx.db.select().from(categories).where(eq(categories.id, article.categoryId)).limit(1)
        : [];
      const og = await renderOgImage({ title: version.seo?.title ?? article.title, category: listCategory?.name });
      const saved = await saveImageAsset(ctx.db, storage, {
        bytes: og.png,
        kind: "graphic",
        origin: "templated",
        prefix: `articles/${article.id}/graphics`,
        role: "og",
        alt: article.title,
        articleId: article.id,
        lossless: true,
      });
      if (version.seo) await setVersionQa(ctx.db, version.id, { seo: { ...version.seo, ogImageAssetId: saved.id } });
      return {
        output: {
          ogAssetId: saved.id,
          pricingCardAssetId: null,
          prosConsAssetId: null,
          badgeAssetId: null,
          framedScreenshotIds: [],
        },
      };
    }
    const productId = article.productId;
    const product = await getProduct(ctx.db, productId);
    const [category] = product?.categoryId
      ? await ctx.db.select().from(categories).where(eq(categories.id, product.categoryId)).limit(1)
      : [];
    const sheet = await latestFactSheet(ctx.db, productId);
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
          productId,
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

    // Latest original per role; a failed frame never fails the step.
    const shots = (await listMedia(ctx.db, { productId }))
      .filter((m) => m.kind === "screenshot" && m.role && FRAMED_ROLES.includes(m.role))
      .filter((m, i, all) => all.findIndex((x) => x.role === m.role) === i);
    const host = (() => {
      try {
        return product ? new URL(product.websiteUrl).hostname.replace(/^www\./, "") : null;
      } catch {
        return null;
      }
    })();
    const framedScreenshotIds: string[] = [];
    for (const shot of shots) {
      try {
        const framed = await saveProcessedScreenshot(
          ctx.db,
          storage,
          shot,
          { frame: "browser", host, maxWidth: 1600 },
          { fetch: ctx.fetch },
        );
        framedScreenshotIds.push(framed.id);
      } catch (error) {
        ctx.log("screenshot frame failed", { role: shot.role, error: String(error) });
      }
    }

    if (version.seo) await setVersionQa(ctx.db, version.id, { seo: { ...version.seo, ogImageAssetId: ogAssetId } });
    return { output: { ogAssetId, pricingCardAssetId, prosConsAssetId, badgeAssetId, framedScreenshotIds } };
  },
});
