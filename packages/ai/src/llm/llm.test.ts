import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CostEvent } from "../cost-event";
import { computeCost, createLlm, LlmParseError, LlmRefusalError, LlmTruncatedError, type AnthropicLike } from "./index";

function fakeClient(message: Record<string, unknown>) {
  const calls: unknown[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: unknown) {
          calls.push(params);
          return { finalMessage: async () => message };
        },
      },
    },
  } as unknown as AnthropicLike;
  return { client, calls };
}

const usage = (input: number, output: number, extra: Record<string, unknown> = {}) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  iterations: null,
  ...extra,
});

describe("computeCost", () => {
  it("prices Opus 5.5 including cache reads and writes", () => {
    const c = computeCost("claude-opus-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    });
    // 1M * $4 + 0.1M * $20 + 1M * $0.20
    expect(c.costUsd).toBeCloseTo(4 + 2 + 0.2, 6);
  });
  it("bills each iteration at its own model when a fallback ran", () => {
    const c = computeCost("claude-opus-5-5", { input_tokens: 0, output_tokens: 0 }, [
      { type: "message", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 0 },
      { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 1000 },
    ]);
    expect(c.models).toEqual(["claude-opus-5-5", "claude-opus-4-8"]);
    expect(c.costUsd).toBeCloseTo((1000 * 4 + 1000 * 5 + 1000 * 25) / 1e6, 9);
  });
  it("applies Haiku 5.5 long-context pricing above 100K prompt tokens", () => {
    const c = computeCost("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 });
    expect(c.costUsd).toBeCloseTo(0.1, 9);
  });
  it("flags models missing from the price table instead of guessing", () => {
    expect(computeCost("claude-unknown-9", { input_tokens: 10, output_tokens: 10 }).unpricedModels).toEqual([
      "claude-unknown-9",
    ]);
  });
});

describe("createLlm", () => {
  it("streams with effort, cached system prompt and default fallback, then reports cost", async () => {
    const { client, calls } = fakeClient({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      stop_details: null,
      content: [{ type: "text", text: "Hello" }],
      usage: usage(100, 20, { cache_read_input_tokens: 500 }),
    });
    const onCost = vi.fn<(e: CostEvent) => void>();
    const llm = createLlm({ client, onCost });
    const res = await llm.generate({
      model: "claude-opus-5-5",
      effort: "high",
      system: "Style guide",
      prompt: "Hi",
      operation: "write",
    });

    expect(res.text).toBe("Hello");
    const params = calls[0] as Record<string, any>;
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.thinking).toBeUndefined();
    expect(onCost).toHaveBeenCalledOnce();
    expect(onCost.mock.calls[0]![0]).toMatchObject({
      provider: "anthropic",
      operation: "write",
      unitType: "tokens",
      units: 620,
    });
  });

  it("does not request fallbacks on Haiku 5.5", async () => {
    const { client, calls } = fakeClient({
      model: "claude-haiku-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "x" }],
      usage: usage(1, 1),
    });
    await createLlm({ client }).generate({
      model: "claude-haiku-5-5",
      effort: "low",
      prompt: "x",
      operation: "extract",
    });
    expect((calls[0] as Record<string, unknown>).fallbacks).toBeUndefined();
  });

  it("raises typed errors for refusal and truncation, after recording cost", async () => {
    const onCost = vi.fn();
    const refused = fakeClient({
      model: "claude-opus-5-5",
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "x" },
      content: [],
      usage: usage(10, 0),
    });
    await expect(
      createLlm({ client: refused.client, onCost }).generate({
        model: "claude-opus-5-5",
        effort: "low",
        prompt: "x",
        operation: "t",
      }),
    ).rejects.toBeInstanceOf(LlmRefusalError);
    expect(onCost).toHaveBeenCalledOnce();

    const cut = fakeClient({
      model: "claude-opus-5-5",
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "partial" }],
      usage: usage(10, 10),
    });
    await expect(
      createLlm({ client: cut.client }).generate({
        model: "claude-opus-5-5",
        effort: "low",
        prompt: "x",
        operation: "t",
        maxTokens: 10,
      }),
    ).rejects.toBeInstanceOf(LlmTruncatedError);
  });

  it("returns validated structured output and rejects schema mismatches", async () => {
    const schema = z.object({ name: z.string(), score: z.number() });
    const good = fakeClient({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"name":"Notion","score":8.5}' }],
      usage: usage(5, 5),
    });
    const res = await createLlm({ client: good.client }).generateStructured({
      model: "claude-opus-5-5",
      effort: "medium",
      prompt: "x",
      operation: "t",
      schema,
    });
    expect(res.data).toEqual({ name: "Notion", score: 8.5 });
    expect((good.calls[0] as Record<string, any>).output_config.format.type).toBe("json_schema");

    const bad = fakeClient({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"name":"Notion"}' }],
      usage: usage(5, 5),
    });
    await expect(
      createLlm({ client: bad.client }).generateStructured({
        model: "claude-opus-5-5",
        effort: "medium",
        prompt: "x",
        operation: "t",
        schema,
      }),
    ).rejects.toBeInstanceOf(LlmParseError);
  });
});
