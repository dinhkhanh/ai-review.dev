import { PRICING, type ModelPricing } from "./models";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface IterationUsage extends TokenUsage {
  type: string;
  model?: string | null;
}

export interface CostBreakdown {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Models that actually served tokens; more than one means a fallback ran. */
  models: string[];
  unpricedModels: string[];
}

function priceOne(usage: TokenUsage, pricing: ModelPricing): number {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const promptTokens = usage.input_tokens + cacheRead + cacheWrite;
  const long = pricing.longContext && promptTokens > pricing.longContext.thresholdTokens ? pricing.longContext : null;
  const inputRate = long?.input ?? pricing.input;
  const outputRate = long?.output ?? pricing.output;
  return (
    (usage.input_tokens * inputRate +
      usage.output_tokens * outputRate +
      cacheRead * pricing.cacheRead +
      cacheWrite * pricing.cacheWrite) /
    1_000_000
  );
}

/**
 * Prices a response. When `iterations` is present (fallbacks, server tools), each iteration is
 * billed at its own model's rate; otherwise the top-level usage is billed at `model`.
 */
export function computeCost(model: string, usage: TokenUsage, iterations?: IterationUsage[] | null): CostBreakdown {
  const parts: Array<{ model: string; usage: TokenUsage }> =
    iterations && iterations.length > 0
      ? iterations
          .filter((it) => it.type === "message" || it.type === "fallback_message")
          .map((it) => ({ model: it.model ?? model, usage: it }))
      : [{ model, usage }];

  const out: CostBreakdown = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    models: [],
    unpricedModels: [],
  };
  for (const part of parts) {
    const pricing = PRICING[part.model];
    if (pricing) out.costUsd += priceOne(part.usage, pricing);
    else if (!out.unpricedModels.includes(part.model)) out.unpricedModels.push(part.model);
    if (!out.models.includes(part.model)) out.models.push(part.model);
    out.inputTokens += part.usage.input_tokens;
    out.outputTokens += part.usage.output_tokens;
    out.cacheReadTokens += part.usage.cache_read_input_tokens ?? 0;
    out.cacheWriteTokens += part.usage.cache_creation_input_tokens ?? 0;
  }
  return out;
}
