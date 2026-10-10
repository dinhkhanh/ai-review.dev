import type { Llm } from "@repo/ai";
import { LAUNCH_CATEGORIES } from "@repo/content";
import type { DbOrTx } from "@repo/db";
import { z } from "zod";
import { resolvePrompt } from "../prompts";
import type { SourcingCandidate } from "./collectors";

const SLUGS = LAUNCH_CATEGORIES.map((c) => c.slug) as [string, ...string[]];

/** Model-facing schema: kept flat (structured-output grammar limits). */
export const classificationSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      categorySlug: z.enum([...SLUGS, "none"]),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});

export interface Classification {
  categorySlug: string | null;
  confidence: number;
  reason: string;
}

/**
 * Category fit for launch candidates (FR-INT-7, D-2), in batches on a cheap model. Candidates the
 * model skips come back as "none". Costs go to the ledger through the injected Llm.
 */
export async function classifyCandidates(
  db: DbOrTx,
  llm: Llm,
  candidates: SourcingCandidate[],
  batchSize = 25,
): Promise<Map<string, Classification>> {
  const out = new Map<string, Classification>();
  if (candidates.length === 0) return out;
  const prompt = await resolvePrompt(db, "product_sourcing");
  const categories = LAUNCH_CATEGORIES.map((c) => `${c.slug}: ${c.name} — ${c.description}`).join("\n");
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const res = await llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "product_sourcing",
      maxTokens: 6_000,
      schema: classificationSchema,
      prompt: [
        `Allowed categories:\n${categories}`,
        `Candidates (id | name | website | description | launch topics):\n${batch
          .map((c) =>
            [
              c.domain,
              c.name,
              c.url,
              (c.description ?? "").replace(/\s+/g, " ").slice(0, 240),
              c.launch.topics.join(", "),
            ].join(" | "),
          )
          .join("\n")}`,
        "Return one item per candidate, using the domain as id.",
      ].join("\n\n"),
    });
    for (const item of res.data.items) {
      out.set(item.id, {
        categorySlug: item.categorySlug === "none" ? null : item.categorySlug,
        confidence: Math.min(1, Math.max(0, item.confidence)),
        reason: item.reason.slice(0, 200),
      });
    }
  }
  return out;
}
