import { seoBriefSchema, slugify } from "@repo/content";
import { getProduct, latestFactSheet, listCompetitors, listPublishedReviews } from "@repo/core";
import { z } from "zod";
import { defineStep } from "../step";

/** seo_brief (FR-CON-1): keywords, intent, title, slug, meta, outline, FAQ, internal links. */
export const seoBriefStep = defineStep({
  name: "seo_brief",
  input: z.object({ productId: z.uuid() }),
  output: z.object({ brief: seoBriefSchema }),
  async run(ctx, input) {
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);
    const [sheet, competitors, existing, serp] = await Promise.all([
      latestFactSheet(ctx.db, product.id),
      listCompetitors(ctx.db, product.id),
      listPublishedReviews(ctx.db, { limit: 100 }),
      ctx.firecrawl.search(`${product.name} review`, { limit: 8 }).catch(() => []),
    ]);
    const angle = typeof ctx.jobInput.angle === "string" ? ctx.jobInput.angle : null;
    const keywords = Array.isArray(ctx.jobInput.keywords) ? (ctx.jobInput.keywords as string[]) : [];
    const prompt = await ctx.prompt("seo_brief");
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "seo_brief",
      maxTokens: 12_000,
      schema: seoBriefSchema,
      prompt: [
        `Product: ${product.name} (${product.websiteUrl}); product slug: ${product.slug}`,
        `Current year: ${new Date().getUTCFullYear()}`,
        angle ? `Admin's review angle: ${angle}` : null,
        keywords.length ? `Admin's target keywords: ${keywords.join(", ")}` : null,
        `Competitors: ${competitors.map((c) => c.name).join(", ") || "none identified"}`,
        sheet
          ? `Fact sheet (values only):\n${JSON.stringify(sheet.data, (k, v) => (k === "citations" || k === "confidence" ? undefined : v))}`
          : null,
        `Current top search results for "${product.name} review":\n${serp.map((h) => `- ${h.title ?? ""} | ${h.description ?? ""}`).join("\n")}`,
        `Existing articles available for internal links (id | title):\n${
          existing
            .filter((a) => a.productId !== product.id)
            .map((a) => `${a.id} | ${a.title}`)
            .join("\n") || "(none yet)"
        }`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const validIds = new Set(existing.map((a) => a.id));
    const brief = {
      ...res.data,
      slug: slugify(res.data.slug) || `${product.slug}-review`,
      internalLinks: res.data.internalLinks.filter((l) => validIds.has(l.articleId)),
      angle: res.data.angle ?? angle,
    };
    return { output: { brief }, model: res.model, effort: prompt.effort, promptVersion: prompt.version };
  },
});
