import { getProduct, listSources, sourceRefs } from "@repo/core";
import { z } from "zod";
import { clip } from "../research/chunk";
import { defineStep, mapLimit } from "../step";

const quoted = <T extends z.ZodType>(value: T) => z.object({ value, quote: z.string() });

/** What one source says about the product. Model-facing: no optional fields, no constraints. */
export const sourceExtractionSchema = z.object({
  relevant: z.boolean(),
  summary: z.string(),
  pricing: z.array(
    z.object({
      tier: z.string(),
      price: z.number().nullable(),
      currency: z.string(),
      period: z.enum(["month", "year", "one_time", "usage", "custom"]),
      limits: z.array(z.string()),
      quote: z.string(),
    }),
  ),
  freePlan: quoted(z.boolean().nullable()),
  freeTrialDays: quoted(z.number().nullable()),
  moneyBackDays: quoted(z.number().nullable()),
  features: z.array(quoted(z.string())),
  integrations: z.array(z.string()),
  platforms: z.array(z.string()),
  security: z.array(quoted(z.string())),
  company: z.object({
    name: z.string().nullable(),
    foundedYear: z.number().nullable(),
    headquarters: z.string().nullable(),
    funding: z.string().nullable(),
    quote: z.string(),
  }),
  ratings: z.array(
    z.object({
      site: z.string(),
      rating: z.number(),
      outOf: z.number(),
      count: z.number().nullable(),
      quote: z.string(),
    }),
  ),
  support: z.array(z.string()),
  limitations: z.array(quoted(z.string())),
  opinions: z.array(
    z.object({ text: z.string(), sentiment: z.enum(["positive", "negative", "mixed"]), quote: z.string() }),
  ),
});
export type SourceExtraction = z.infer<typeof sourceExtractionSchema>;

const extractionOutput = z.object({
  ref: z.string(),
  sourceId: z.string(),
  url: z.string(),
  kind: z.string(),
  data: sourceExtractionSchema.nullable(),
  error: z.string().nullable(),
});
export type ExtractionRecord = z.infer<typeof extractionOutput>;

/** extract_facts (docs/plan.md §5): cheap per-source structured extraction, run in parallel. */
export const extractFactsStep = defineStep({
  name: "extract_facts",
  input: z.object({ productId: z.uuid() }),
  output: z.object({ extractions: z.array(extractionOutput), relevant: z.number() }),
  async run(ctx, input) {
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);
    const sources = await listSources(ctx.db, input.productId, { withContent: true });
    const refs = sourceRefs(sources);
    const prompt = await ctx.prompt("extract_facts");
    const usable = sources.filter((s) => (s.contentMd ?? "").trim().length > 80);

    const extractions = await mapLimit(usable, 6, async (source): Promise<ExtractionRecord> => {
      const base = { ref: refs.ref(source.id), sourceId: source.id, url: source.url, kind: source.kind };
      try {
        const res = await ctx.llm.generateStructured({
          model: prompt.model,
          effort: prompt.effort,
          system: prompt.system,
          operation: "extract_facts",
          maxTokens: 8000,
          schema: sourceExtractionSchema,
          prompt: `Product: ${product.name} (${product.websiteUrl})\nPage (${source.kind}): ${source.url}\nTitle: ${source.title ?? ""}\nFetched: ${source.fetchedAt.toISOString().slice(0, 10)}\n\n<page>\n${clip(source.contentMd, 24_000)}\n</page>`,
        });
        return { ...base, data: res.data, error: null };
      } catch (error) {
        ctx.log("extraction failed", { url: source.url, error: String(error) });
        return { ...base, data: null, error: String(error).slice(0, 300) };
      }
    });
    const relevant = extractions.filter((e) => e.data?.relevant).length;
    if (relevant === 0) throw new Error("No source contained usable facts about the product");
    return {
      output: { extractions, relevant },
      model: prompt.model,
      effort: prompt.effort,
      promptVersion: prompt.version,
    };
  },
});
