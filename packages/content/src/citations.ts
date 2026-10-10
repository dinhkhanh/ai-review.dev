import { z } from "zod";

/** A reference from generated content back to a stored research source (FR-CON-4). */
export const citationSchema = z.object({
  sourceId: z.uuid(),
  /** Short verbatim excerpt that supports the claim; kept for fact-checking, not rendered in full. */
  quote: z.string().max(500).optional(),
});
export type Citation = z.infer<typeof citationSchema>;

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

/** A value with provenance, used throughout the fact sheet. */
export const cited = <T extends z.ZodType>(value: T) =>
  z.object({
    value,
    citations: z.array(citationSchema).default([]),
    confidence: confidenceSchema.default("medium"),
  });
