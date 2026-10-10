import { MODELS, type Llm } from "@repo/ai";
import { articleText, type ArticleBody, type FactSheet } from "@repo/content";
import { z } from "zod";
import type { Check } from "./scoring";

/** LLM-judge scores, 1–5 each. Flat model-facing schema (structured-output grammar limits). */
export const judgeSchema = z.object({
  accuracy: z.number(),
  helpfulness: z.number(),
  specificity: z.number(),
  tone: z.number(),
  structure: z.number(),
  problems: z.array(z.string()),
  summary: z.string(),
});
export type JudgeScores = z.infer<typeof judgeSchema>;

export const JUDGE_DIMENSIONS = ["accuracy", "helpfulness", "specificity", "tone", "structure"] as const;

/** Fixed judge rubric: changing it invalidates comparisons with earlier runs, so version it. */
export const JUDGE_VERSION = "judge@v1";
export const JUDGE_SYSTEM = `You grade a software review written for an affiliate review site. Be strict and consistent.

Score each dimension from 1 (poor) to 5 (excellent):
- accuracy: every price, limit and feature agrees with the fact sheet; nothing is invented. One wrong price caps this at 2.
- helpfulness: a buyer could decide from it — who it is for, who should skip it, real trade-offs and alternatives.
- specificity: concrete numbers, named features and examples instead of generic praise.
- tone: plain, first-person-plural editorial voice; no hype, filler or AI clichés; honest about weaknesses.
- structure: logical order, scannable headings, no repetition between sections.

List concrete problems (quote the sentence) and give a one-sentence summary.`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Fact sheet without provenance, to keep the judge prompt small. */
function plainFacts(sheet: FactSheet | null): string {
  return JSON.stringify(sheet ?? {}, (k, v) => (k === "citations" || k === "confidence" ? undefined : v));
}

export async function judgeArticle(
  llm: Llm,
  input: { productName: string; factSheet: FactSheet | null; blocks: ArticleBody },
): Promise<{ scores: JudgeScores; mean: number; checks: Check[] }> {
  const res = await llm.generateStructured({
    model: MODELS.haiku,
    effort: "low",
    system: JUDGE_SYSTEM,
    operation: "eval_judge",
    maxTokens: 4000,
    schema: judgeSchema,
    prompt: [
      `Product: ${input.productName}`,
      `Fact sheet (ground truth):\n${clip(plainFacts(input.factSheet), 20_000)}`,
      `Review text:\n<review>\n${clip(articleText(input.blocks), 40_000)}\n</review>`,
    ].join("\n\n"),
  });
  const scores = res.data;
  const clamp = (n: number) => Math.min(5, Math.max(1, n));
  const mean = JUDGE_DIMENSIONS.reduce((s, d) => s + clamp(scores[d]), 0) / JUDGE_DIMENSIONS.length;
  return {
    scores,
    mean: Math.round(mean * 100) / 100,
    checks: [
      { name: "judge_mean>=3.5", passed: mean >= 3.5, detail: `${Math.round(mean * 100) / 100}` },
      { name: "judge_accuracy>=4", passed: clamp(scores.accuracy) >= 4, detail: `${scores.accuracy}` },
    ],
  };
}
