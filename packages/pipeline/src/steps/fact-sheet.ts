import { factSheetSchema, type Citation, type FactSheet } from "@repo/content";
import { getProduct, listSources, pricingCitationCoverage, saveFactSheet, sourceRefs } from "@repo/core";
import { z } from "zod";
import { clip } from "../research/chunk";
import { defineStep } from "../step";
import type { ExtractionRecord } from "./extract-facts";

const confidence = z.enum(["high", "medium", "low"]);

/** Fact kinds the model reports; list kinds may repeat, scalar kinds appear once. */
export const FACT_FIELDS = [
  "tagline",
  "free_plan",
  "free_trial_days",
  "money_back_days",
  "feature",
  "platform",
  "integration",
  "security",
  "support",
  "limitation",
  "company_name",
  "founded_year",
  "headquarters",
  "funding",
] as const;

/**
 * Model-facing fact sheet (v2): one flat list of cited facts plus pricing tiers and ratings.
 * Kept deliberately small: deeply nested per-field wrappers exceed the structured-output grammar
 * limit. Refs are "S<n>" strings; code maps them to source ids and builds the FactSheet.
 */
export const factSheetDraftSchema = z.object({
  pricingTiers: z.array(
    z.object({
      name: z.string(),
      price: z.number().nullable(),
      currency: z.string(),
      period: z.enum(["month", "year", "one_time", "usage", "custom"]),
      limits: z.array(z.string()),
      highlights: z.array(z.string()),
    }),
  ),
  pricingRefs: z.array(z.string()),
  pricingConfidence: confidence,
  facts: z.array(z.object({ field: z.enum(FACT_FIELDS), value: z.string(), refs: z.array(z.string()), confidence })),
  ratings: z.array(
    z.object({
      site: z.string(),
      rating: z.number(),
      outOf: z.number(),
      count: z.number().nullable(),
      ref: z.string(),
    }),
  ),
});
export type FactSheetDraft = z.infer<typeof factSheetDraftSchema>;

type Conf = "high" | "medium" | "low";
const RANK: Record<Conf, number> = { low: 0, medium: 1, high: 2 };

/** Converts the model draft to a FactSheet: maps refs to source ids, drops uncited/unknown values. */
export function draftToFactSheet(
  draft: FactSheetDraft,
  ctx: {
    name: string;
    website: string;
    pricingUrl?: string | null;
    refToId: (ref: string) => string | null;
    sourceById: Map<string, { url: string; fetchedAt: Date }>;
  },
): FactSheet {
  const cites = (refs: string[]): Citation[] =>
    [...new Set(refs.map((r) => ctx.refToId(r.replace(/[^A-Za-z0-9]/g, ""))).filter((id): id is string => !!id))].map(
      (sourceId) => ({ sourceId }),
    );
  const of = (field: (typeof FACT_FIELDS)[number]) =>
    draft.facts.filter((f) => f.field === field && f.value.trim() && cites(f.refs).length > 0);
  const scalar = <T>(field: (typeof FACT_FIELDS)[number], parse: (v: string) => T | null) => {
    const f = of(field)[0];
    if (!f) return undefined;
    const value = parse(f.value.trim());
    return value === null ? undefined : { value, citations: cites(f.refs), confidence: f.confidence };
  };
  const list = (field: (typeof FACT_FIELDS)[number]) => {
    const items = of(field);
    if (items.length === 0) return undefined;
    const minConf = items.reduce<Conf>((m, f) => (RANK[f.confidence] < RANK[m] ? f.confidence : m), "high");
    return {
      value: [...new Set(items.map((f) => f.value.trim()))],
      citations: cites(items.flatMap((f) => f.refs)),
      confidence: minConf,
    };
  };
  const each = (field: (typeof FACT_FIELDS)[number]) =>
    of(field).map((f) => ({ value: f.value.trim(), citations: cites(f.refs), confidence: f.confidence }));
  const int = (v: string) => {
    const n = Number.parseInt(v.replace(/[^0-9-]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  };
  const bool = (v: string) => (/^(true|yes)$/i.test(v) ? true : /^(false|no)$/i.test(v) ? false : null);
  const str = (v: string) => v;
  const company = {
    name: scalar("company_name", str),
    foundedYear: scalar("founded_year", int),
    headquarters: scalar("headquarters", str),
    funding: scalar("funding", str),
  };
  return factSheetSchema.parse({
    name: ctx.name,
    website: ctx.website,
    tagline: scalar("tagline", str),
    pricing: draft.pricingTiers.length
      ? {
          tiers: {
            value: draft.pricingTiers.map((t) => ({ ...t, currency: (t.currency || "USD").toUpperCase().slice(0, 3) })),
            citations: cites(draft.pricingRefs),
            confidence: draft.pricingConfidence,
          },
          freePlan: scalar("free_plan", bool),
          freeTrialDays: scalar("free_trial_days", int),
          moneyBackDays: scalar("money_back_days", int),
          ...(ctx.pricingUrl ? { pricingUrl: ctx.pricingUrl } : {}),
        }
      : undefined,
    features: each("feature"),
    platforms: list("platform"),
    integrations: list("integration"),
    security: list("security"),
    support: list("support"),
    company: Object.values(company).some(Boolean) ? company : undefined,
    ratings: draft.ratings.flatMap((r) => {
      const id = ctx.refToId(r.ref.replace(/[^A-Za-z0-9]/g, ""));
      const source = id ? ctx.sourceById.get(id) : undefined;
      if (!source) return [];
      return [
        {
          site: r.site,
          url: source.url,
          rating: r.rating,
          outOf: r.outOf || 5,
          count: r.count === null ? null : Math.max(0, Math.round(r.count)),
          observedAt: source.fetchedAt.toISOString(),
        },
      ];
    }),
    limitations: each("limitation"),
  });
}

/** fact_sheet (FR-RES-4): merge extractions into a cited, versioned fact sheet with a diff. */
export const factSheetStep = defineStep({
  name: "fact_sheet",
  input: z.object({ productId: z.uuid() }),
  output: z.object({
    factSheetId: z.string(),
    version: z.number(),
    changes: z.number(),
    pricingCoverage: z.number(),
    features: z.number(),
    ratings: z.number(),
  }),
  async run(ctx, input) {
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);
    const extracted = await ctx.previous<{ extractions: ExtractionRecord[] }>("extract_facts");
    if (!extracted) throw new Error("extract_facts output missing");
    const sources = await listSources(ctx.db, product.id, { withContent: true });
    const refs = sourceRefs(sources);
    const relevant = extracted.extractions.filter((e) => e.data?.relevant);
    const pricingSource =
      sources.find((s) => s.url === product.profile?.pricingUrl) ?? sources.find((s) => /pricing|plans/i.test(s.url));

    const prompt = await ctx.prompt("fact_sheet");
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "fact_sheet",
      maxTokens: 32_000,
      schema: factSheetDraftSchema,
      prompt: [
        `Product: ${product.name} — ${product.websiteUrl}`,
        `Today: ${new Date().toISOString().slice(0, 10)}`,
        `Sources:\n${relevant.map((e) => `${e.ref} [${e.kind}] ${e.url}`).join("\n")}`,
        `Per-source extractions (JSON, keyed by ref):\n${JSON.stringify(
          Object.fromEntries(relevant.map((e) => [e.ref, { kind: e.kind, ...e.data, relevant: undefined }])),
        )}`,
        pricingSource
          ? `Official pricing page ${refs.ref(pricingSource.id)} (verbatim, truncated):\n<page>\n${clip(pricingSource.contentMd, 14_000)}\n</page>`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const sheet = draftToFactSheet(res.data, {
      name: product.name,
      website: product.websiteUrl,
      pricingUrl: product.profile?.pricingUrl ?? null,
      refToId: refs.id,
      sourceById: new Map(sources.map((s) => [s.id, { url: s.url, fetchedAt: s.fetchedAt }])),
    });
    const saved = await saveFactSheet(ctx.db, product.id, sheet, { jobId: ctx.jobId });
    const coverage = pricingCitationCoverage(sheet);
    ctx.log("fact sheet saved", { version: saved.version, changes: saved.diffFromPrevious?.length ?? 0, coverage });
    return {
      output: {
        factSheetId: saved.id,
        version: saved.version,
        changes: saved.diffFromPrevious?.length ?? 0,
        pricingCoverage: coverage,
        features: sheet.features.length,
        ratings: sheet.ratings.length,
      },
      model: res.model,
      effort: prompt.effort,
      promptVersion: prompt.version,
    };
  },
});
