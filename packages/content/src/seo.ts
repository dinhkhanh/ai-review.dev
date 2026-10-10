import { z } from "zod";

export const seoSchema = z.object({
  title: z.string().max(70),
  metaDescription: z.string().max(170),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()).default([]),
  intent: z.enum(["review", "comparison", "alternatives", "best_of", "pricing", "how_to"]),
  ogImageAssetId: z.uuid().optional(),
  internalLinks: z.array(z.object({ articleId: z.uuid(), anchor: z.string() })).default([]),
});
export type Seo = z.infer<typeof seoSchema>;

/** Automated quality gate results shown in the CMS (FR-QA-1). */
export const qaScorecardSchema = z.object({
  hardGatesPassed: z.boolean(),
  checks: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      hard: z.boolean(),
      passed: z.boolean(),
      value: z.union([z.number(), z.string(), z.boolean()]).optional(),
      detail: z.string().optional(),
    }),
  ),
  computedAt: z.iso.datetime(),
});
export type QaScorecard = z.infer<typeof qaScorecardSchema>;
