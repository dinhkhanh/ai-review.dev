import {
  findOrCreateProduct,
  getProduct,
  latestFactSheet,
  normalizeWebsiteUrl,
  registrableDomain,
  setCompetitors,
} from "@repo/core";
import { z } from "zod";
import { defineStep } from "../step";

export const competitorDraftSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      website: z.string(),
      positioning: z.string(),
      relation: z.enum(["direct", "alternative"]),
    }),
  ),
});

/** competitors (FR-RES-5): 3–8 alternatives; each becomes a draft product for comparisons and links. */
export const competitorsStep = defineStep({
  name: "competitors",
  input: z.object({ productId: z.uuid(), hints: z.array(z.string()).default([]) }),
  output: z.object({
    competitors: z.array(
      z.object({ productId: z.string(), name: z.string(), relation: z.string(), positioning: z.string() }),
    ),
  }),
  async run(ctx, input) {
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);
    const sheet = await latestFactSheet(ctx.db, product.id);
    const hits = await ctx.firecrawl.search(`${product.name} alternatives`, { limit: 8 }).catch(() => []);
    const prompt = await ctx.prompt("competitors");
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "competitors",
      maxTokens: 6000,
      schema: competitorDraftSchema,
      prompt: [
        `Product: ${product.name} (${product.websiteUrl}) — ${product.tagline ?? ""}`,
        input.hints.length ? `Competitors the admin wants included: ${input.hints.join(", ")}` : null,
        sheet ? `Features: ${sheet.data.features.map((f) => f.value).join("; ")}` : null,
        `Search results for "${product.name} alternatives":\n${hits.map((h) => `- ${h.title ?? ""} — ${h.url}\n  ${h.description ?? ""}`).join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const out: Array<{ productId: string; name: string; relation: "direct" | "alternative"; positioning: string }> = [];
    for (const c of res.data.competitors.slice(0, 8)) {
      let website: string;
      try {
        website = normalizeWebsiteUrl(c.website);
        if (registrableDomain(website) === product.domain) continue;
      } catch {
        ctx.log("skipping competitor with invalid website", { name: c.name, website: c.website });
        continue;
      }
      const { product: comp } = await findOrCreateProduct(ctx.db, {
        name: c.name,
        websiteUrl: website,
        categoryId: product.categoryId,
        tagline: c.positioning,
      });
      if (!out.some((o) => o.productId === comp.id)) {
        out.push({ productId: comp.id, name: comp.name, relation: c.relation, positioning: c.positioning });
      }
    }
    await setCompetitors(
      ctx.db,
      product.id,
      out.map((c) => ({ competitorProductId: c.productId, relation: c.relation, note: c.positioning })),
    );
    return { output: { competitors: out }, model: res.model, effort: prompt.effort, promptVersion: prompt.version };
  },
});
