import { z } from "zod";
import { cited } from "./citations";

/** Structured, cited facts about a product (FR-RES-4). Versioned in `fact_sheets`. */
export const pricingTierSchema = z.object({
  name: z.string(),
  price: z.number().nullable(),
  currency: z.string().length(3).default("USD"),
  period: z.enum(["month", "year", "one_time", "usage", "custom"]),
  limits: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
});

export const aggregatorRatingSchema = z.object({
  site: z.string(),
  url: z.url(),
  rating: z.number(),
  outOf: z.number().default(5),
  count: z.number().int().nonnegative().nullable(),
  observedAt: z.iso.datetime(),
});

export const factSheetSchema = z.object({
  name: z.string(),
  tagline: cited(z.string()).optional(),
  website: z.url(),
  pricing: z
    .object({
      tiers: cited(z.array(pricingTierSchema)),
      freePlan: cited(z.boolean()).optional(),
      freeTrialDays: cited(z.number().int().nonnegative().nullable()).optional(),
      moneyBackDays: cited(z.number().int().nonnegative().nullable()).optional(),
      pricingUrl: z.url().optional(),
    })
    .optional(),
  features: z.array(cited(z.string())).default([]),
  platforms: cited(z.array(z.string())).optional(),
  integrations: cited(z.array(z.string())).optional(),
  security: cited(z.array(z.string())).optional(),
  company: z
    .object({
      name: cited(z.string()).optional(),
      foundedYear: cited(z.number().int()).optional(),
      headquarters: cited(z.string()).optional(),
      funding: cited(z.string()).optional(),
    })
    .optional(),
  support: cited(z.array(z.string())).optional(),
  ratings: z.array(aggregatorRatingSchema).default([]),
  limitations: z.array(cited(z.string())).default([]),
});
export type FactSheet = z.infer<typeof factSheetSchema>;
