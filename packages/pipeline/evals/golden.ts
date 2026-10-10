import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Golden set for prompt evals (docs/plan.md §5 "Evals"). Every expectation records the public
 * page it came from and when it was checked, so a failing case can be re-verified by hand.
 */
export const goldenExpectSchema = z.object({
  source: z.object({ url: z.url(), checkedAt: z.iso.date(), note: z.string() }),
  /** Tier names that must appear in the fact sheet (case-insensitive). */
  tiers: z.array(z.string()),
  /** Monthly (or stated-period) prices; `tier: null` matches any tier. */
  prices: z.array(
    z.object({
      tier: z.string().nullable(),
      price: z.number().nonnegative(),
      period: z.enum(["month", "year", "one_time", "usage", "custom"]),
      /** Accepted absolute difference, e.g. 2 when the page shows both monthly and yearly-billed prices. */
      tolerance: z.number().nonnegative(),
    }),
  ),
  /** null = the page does not state it either way; not checked. */
  freePlan: z.boolean().nullable(),
  trialDays: z.number().int().nonnegative().nullable(),
  /** Lower-case substrings at least one fact-sheet feature must contain. */
  features: z.array(z.string()),
  /** Sanity band for the computed overall score (catches broken scoring, not ground truth). */
  rubricOverall: z.tuple([z.number(), z.number()]),
});
export type GoldenExpect = z.infer<typeof goldenExpectSchema>;

export const goldenCaseSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  category: z.string().min(1),
  /** evals/snapshots/<name>.json; null until the product has been researched and exported. */
  snapshot: z.string().nullable(),
  expect: goldenExpectSchema,
});
export type GoldenCase = z.infer<typeof goldenCaseSchema>;

export const goldenSetSchema = z.object({ cases: z.array(goldenCaseSchema).min(1) });

export function loadGoldenSet(path = new URL("./golden.json", import.meta.url)): GoldenCase[] {
  const parsed = goldenSetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const slugs = parsed.cases.map((c) => c.slug);
  const dup = slugs.find((s, i) => slugs.indexOf(s) !== i);
  if (dup) throw new Error(`Duplicate golden case: ${dup}`);
  return parsed.cases;
}
