import { MODELS } from "@repo/ai";
import { z } from "zod";
import { defineStep } from "../step";

/**
 * Phase 0 end-to-end check: proves orchestration, step persistence and the cost ledger work.
 * With `useLlm`, makes one tiny Haiku call so the Anthropic key and ledger are verified too.
 */
export const smokeStep = defineStep({
  name: "smoke",
  input: z.object({ message: z.string().min(1).max(200), useLlm: z.boolean().default(false) }),
  output: z.object({ echo: z.string(), llmReply: z.string().nullable(), costUsd: z.number() }),
  async run(ctx, input) {
    ctx.log("smoke step running", { useLlm: input.useLlm });
    if (!input.useLlm) return { output: { echo: input.message, llmReply: null, costUsd: 0 } };
    const res = await ctx.llm.generate({
      model: MODELS.haiku,
      effort: "low",
      prompt: `Reply with exactly the word "pong". Message: ${input.message}`,
      maxTokens: 2000,
      operation: "smoke",
    });
    return {
      output: { echo: input.message, llmReply: res.text.trim(), costUsd: res.cost.costUsd },
      model: res.model,
      effort: "low",
      tokensIn: res.cost.inputTokens,
      tokensOut: res.cost.outputTokens,
    };
  },
});
