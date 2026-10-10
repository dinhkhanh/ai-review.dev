import { z } from "zod";

export const claimVerdictSchema = z.enum(["supported", "unsupported", "outdated", "uncited"]);
export type ClaimVerdict = z.infer<typeof claimVerdictSchema>;

/** One factual claim found in an article and how it held up against its sources (FR-CON-4/5). */
export const checkedClaimSchema = z.object({
  id: z.string(),
  blockId: z.string(),
  text: z.string(),
  sourceIds: z.array(z.string()),
  verdict: claimVerdictSchema,
  note: z.string().nullable().default(null),
  /** True when the fact-check step rewrote the sentence to fix it. */
  fixed: z.boolean().default(false),
});
export type CheckedClaim = z.infer<typeof checkedClaimSchema>;

export const factCheckReportSchema = z.object({
  claims: z.array(checkedClaimSchema),
  supported: z.number().int(),
  unsupported: z.number().int(),
  outdated: z.number().int(),
  uncited: z.number().int(),
  fixedCount: z.number().int(),
  checkedAt: z.iso.datetime(),
});
export type FactCheckReport = z.infer<typeof factCheckReportSchema>;

/** Claims that block publication until fixed or removed. */
export function blockingClaims(report: Pick<FactCheckReport, "claims">): CheckedClaim[] {
  return report.claims.filter((c) => c.verdict === "unsupported" || c.verdict === "outdated");
}
