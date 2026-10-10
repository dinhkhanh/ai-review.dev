import { z } from "zod";

/** Short social posts generated from an article (FR-CON-8). Each links to the article or its go-link. */
export const socialSnippetsSchema = z.object({
  x: z.string().max(280),
  linkedin: z.string().max(3000),
  threads: z.string().max(500),
  /** URL the posts point at (the article page, which carries the CTAs and disclosure). */
  url: z.url(),
  generatedAt: z.iso.datetime(),
});
export type SocialSnippets = z.infer<typeof socialSnippetsSchema>;
