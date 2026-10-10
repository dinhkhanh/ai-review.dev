import { createLlm, type AnthropicLike, type FirecrawlAdapter } from "@repo/ai";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runPipelineSmoke } from "./run-smoke";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
  await ctx.reset();
});
afterAll(async () => ctx.close());

const fake: AnthropicLike = {
  beta: {
    messages: {
      stream: () => ({
        finalMessage: async () =>
          ({
            model: "claude-haiku-5-5",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "pong" }],
            usage: {
              input_tokens: 30,
              output_tokens: 1,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              iterations: null,
            },
          }) as never,
      }),
    },
  },
};

describe("runPipelineSmoke", () => {
  it("creates a job, runs the step and marks the job succeeded with its cost", async () => {
    const res = await runPipelineSmoke(ctx.db, {
      message: "ping",
      useLlm: true,
      services: {
        db: ctx.db,
        makeLlm: (onCost) => createLlm({ client: fake, onCost }),
        makeFirecrawl: () => ({}) as FirecrawlAdapter,
      },
    });
    expect(res.output.llmReply).toBe("pong");
    expect(res.job?.status).toBe("succeeded");
    expect(Number(res.job?.totalCostUsd)).toBeGreaterThan(0);
  });
});
