import { z } from "zod";

/** Canonical product identity resolved at intake (FR-INT-3). Stored on `products.profile`. */
export const productProfileSchema = z.object({
  pricingUrl: z.url().nullable().default(null),
  docsUrl: z.url().nullable().default(null),
  changelogUrl: z.url().nullable().default(null),
  logoUrl: z.url().nullable().default(null),
  /** e.g. { x: "https://x.com/notionhq", linkedin: "..." } */
  socials: z.record(z.string(), z.url()).default({}),
  appStores: z.array(z.url()).default([]),
});
export type ProductProfile = z.infer<typeof productProfileSchema>;
