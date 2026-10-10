import { describe, expect, it, vi } from "vitest";
import { createVoyageEmbedder } from "./index";

describe("createVoyageEmbedder", () => {
  it("returns null without an API key", () => {
    expect(createVoyageEmbedder({ apiKey: "" })).toBeNull();
  });
  it("batches, restores order and records cost", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { input: string[] };
      calls.push(body);
      return Response.json({
        data: body.input.map((t, index) => ({ index, embedding: [t.length] })).reverse(),
        usage: { total_tokens: 1000 },
      });
    }) as unknown as typeof fetch;
    const onCost = vi.fn();
    const e = createVoyageEmbedder({ apiKey: "k", fetchImpl, onCost, batchSize: 2 })!;
    expect(await e.embed(["a", "bb", "ccc"], { inputType: "query" })).toEqual([[1], [2], [3]]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ model: "voyage-3.5", input_type: "query", output_dimension: 1024 });
    expect(onCost).toHaveBeenCalledTimes(2);
    expect(onCost.mock.calls[0]![0]).toMatchObject({ provider: "voyage", units: 1000, costUsd: 0.00006 });
  });
  it("surfaces HTTP errors", async () => {
    const e = createVoyageEmbedder({
      apiKey: "k",
      fetchImpl: (async () => new Response("bad", { status: 401 })) as typeof fetch,
    })!;
    await expect(e.embed(["x"])).rejects.toThrow(/401/);
  });
});
