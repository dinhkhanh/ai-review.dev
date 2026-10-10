import { z } from "zod";

/** SEO brief produced before writing (FR-CON-1). Stored on `articles.brief`. */
export const seoBriefSchema = z.object({
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  intent: z.enum(["review", "comparison", "alternatives", "best_of", "pricing", "how_to"]),
  titleCandidates: z.array(z.string()),
  title: z.string(),
  slug: z.string(),
  metaDescription: z.string(),
  outline: z.array(z.object({ heading: z.string(), points: z.array(z.string()) })),
  faqQuestions: z.array(z.string()),
  /** Existing published articles worth linking to, by id. */
  internalLinks: z.array(z.object({ articleId: z.string(), anchor: z.string() })),
  /** Who the review is for, carried into the writing prompt. */
  angle: z.string().nullable(),
});
export type SeoBrief = z.infer<typeof seoBriefSchema>;
