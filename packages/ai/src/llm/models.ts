/**
 * Claude models used by the pipeline and their list prices (USD per million tokens, Anthropic
 * first-party API, as of 2026-10). Update here when pricing changes; the cost ledger reads this.
 */
export const MODELS = {
  /** Default for writing, fact sheets, fact-checking (docs/plan.md §3). */
  opus: "claude-opus-5-5",
  /** Mid-tier steps: style pass, competitors, affiliate discovery. */
  sonnet: "claude-sonnet-5-5",
  /** Bulk extraction and classification. */
  haiku: "claude-haiku-5-5",
} as const;

export type ModelId =
  (typeof MODELS)[keyof typeof MODELS] | "claude-fable-5-1" | "claude-opus-5" | "claude-opus-4-8" | "claude-sonnet-5";

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute TTL cache writes bill at 1.25x input. */
  cacheWrite: number;
  /** Haiku 5.5 bills prompts above 100K tokens at a higher rate. */
  longContext?: { thresholdTokens: number; input: number; output: number };
}

const fromBase = (input: number, output: number, cacheRead: number): ModelPricing => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

export const PRICING: Record<string, ModelPricing> = {
  "claude-fable-5-1": fromBase(10, 50, 0.25),
  "claude-opus-5-5": fromBase(4, 20, 0.2),
  "claude-opus-5": fromBase(5, 25, 0.5),
  "claude-opus-4-8": fromBase(5, 25, 0.5),
  "claude-sonnet-5-5": fromBase(2, 10, 0.2),
  "claude-sonnet-5": fromBase(2, 10, 0.2),
  "claude-haiku-5-5": {
    ...fromBase(0.1, 0.5, 0.01),
    longContext: { thresholdTokens: 100_000, input: 0.5, output: 2.5 },
  },
};

/**
 * Models that accept server-side refusal fallback with `fallbacks: "default"` on the Claude API.
 * Haiku 5.5 has no server-side fallback.
 */
export const SUPPORTS_DEFAULT_FALLBACK = new Set<string>([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
