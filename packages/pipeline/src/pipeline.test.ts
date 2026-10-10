import type { CostHandler, FirecrawlAdapter } from "@repo/ai";
import { createLlm, type AnthropicLike } from "@repo/ai";
import { createReviewJob, getJob } from "@repo/core";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineStep, executeStep, smokeStep, type StepServices } from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const fakeAnthropic: AnthropicLike = {
  beta: {
    messages: {
      stream: () => ({
        finalMessage: async () =>
          ({
            model: "claude-haiku-5-5",
            stop_reason: "end_turn",
            stop_details: null,
            content: [{ type: "text", text: "pong" }],
            usage: {
              input_tokens: 40,
              output_tokens: 2,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              iterations: null,
            },
          }) as never,
      }),
    },
  },
};

function services(): StepServices {
  return {
    db: ctx.db,
    makeLlm: (onCost: CostHandler) => createLlm({ client: fakeAnthropic, onCost }),
    makeFirecrawl: () => ({}) as FirecrawlAdapter,
  };
}

describe("executeStep", () => {
  it("persists output, attributes LLM cost to the step and job, and does not re-run a succeeded attempt", async () => {
    const job = await createReviewJob(ctx.db, { preset: "quick_review", input: {} });
    const out = await executeStep(services(), smokeStep, { message: "ping", useLlm: true }, { jobId: job.id });
    expect(out.llmReply).toBe("pong");

    const again = await executeStep(services(), smokeStep, { message: "ping", useLlm: true }, { jobId: job.id });
    expect(again).toEqual(out);

    const loaded = await getJob(ctx.db, job.id);
    expect(loaded!.steps).toHaveLength(1);
    expect(loaded!.steps[0]).toMatchObject({
      name: "smoke",
      status: "succeeded",
      model: "claude-haiku-5-5",
      tokensIn: 40,
      tokensOut: 2,
    });
    // 40 * $0.10/M + 2 * $0.50/M
    expect(Number(loaded!.totalCostUsd)).toBeCloseTo(0.000005, 6);
  });

  it("records failures with the error and rethrows; a new attempt can then succeed", async () => {
    let calls = 0;
    const flaky = defineStep({
      name: "competitors",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      async run() {
        calls++;
        if (calls === 1) throw new Error("upstream 503");
        return { output: { ok: true } };
      },
    });
    const job = await createReviewJob(ctx.db, { preset: "quick_review", input: {} });
    await expect(executeStep(services(), flaky, {}, { jobId: job.id, attempt: 1 })).rejects.toThrow("upstream 503");
    await executeStep(services(), flaky, {}, { jobId: job.id, attempt: 2 });

    const steps = (await getJob(ctx.db, job.id))!.steps;
    expect(steps.map((s) => [s.attempt, s.status])).toEqual([
      [1, "failed"],
      [2, "succeeded"],
    ]);
    expect(steps[0]!.error).toContain("upstream 503");
  });

  it("rejects invalid input before recording anything", async () => {
    const job = await createReviewJob(ctx.db, { preset: "quick_review", input: {} });
    await expect(executeStep(services(), smokeStep, { message: "" }, { jobId: job.id })).rejects.toThrow();
    expect((await getJob(ctx.db, job.id))!.steps).toHaveLength(0);
  });
});
