import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { CostHandler } from "../cost-event";
import { computeCost, type CostBreakdown, type IterationUsage } from "./cost";
import { LlmParseError, LlmRefusalError, LlmTruncatedError } from "./errors";
import { SUPPORTS_DEFAULT_FALLBACK, type Effort } from "./models";

import type {
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams as StreamParams,
  BetaTextBlock,
} from "@anthropic-ai/sdk/resources/beta/messages";

/** The subset of the Anthropic client this wrapper uses; tests pass a fake. */
export interface AnthropicLike {
  beta: { messages: { stream(params: StreamParams): { finalMessage(): Promise<BetaMessage> } } };
}

export interface GenerateOptions {
  model: string;
  /** Thinking depth / token spend. Opus 5.5 defaults to "medium" server-side; we always send it. */
  effort: Effort;
  /** Stable instructions (style guide, rubric...). Cached as the prompt prefix when `cacheSystem`. */
  system?: string;
  /** Either a single user prompt or a full message list. */
  prompt?: string;
  messages?: BetaMessageParam[];
  maxTokens?: number;
  /** Mark the system prompt as a cache breakpoint (default true). */
  cacheSystem?: boolean;
  /** Ledger label, e.g. "fact_sheet". */
  operation: string;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  /** Model that served the final answer (differs from the request if a fallback ran). */
  model: string;
  stopReason: string | null;
  fallbackUsed: boolean;
  cost: CostBreakdown;
  raw: BetaMessage;
}

export interface StructuredResult<T> extends GenerateResult {
  data: T;
}

export interface LlmOptions {
  client?: AnthropicLike;
  onCost?: CostHandler;
  /** Disable server-side refusal fallback (on by default where supported). */
  disableFallbacks?: boolean;
}

const DEFAULT_MAX_TOKENS = 64_000;

/**
 * Thin, opinionated wrapper over the Anthropic SDK used by every pipeline step:
 * - always streams (long outputs never hit HTTP timeouts) and returns the final message;
 * - sends per-step `effort`; thinking is left at the model default (adaptive);
 * - caches the system prompt prefix;
 * - opts into server-side refusal fallback (`fallbacks: "default"`) on supported models;
 * - turns refusal / truncation into typed errors instead of silently returning partial content;
 * - prices every call (per served model) and reports it to `onCost`.
 */
export function createLlm(options: LlmOptions = {}) {
  const client: AnthropicLike = options.client ?? new Anthropic();

  async function run(opts: GenerateOptions, format?: ReturnType<typeof betaZodOutputFormat>): Promise<GenerateResult> {
    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const messages: BetaMessageParam[] = opts.messages ?? [{ role: "user", content: opts.prompt ?? "" }];
    if (!opts.messages && !opts.prompt) throw new Error("generate() needs `prompt` or `messages`");

    const useFallback = !options.disableFallbacks && SUPPORTS_DEFAULT_FALLBACK.has(opts.model);
    const params: StreamParams = {
      model: opts.model,
      max_tokens: maxTokens,
      messages,
      ...(opts.system
        ? {
            system: [
              {
                type: "text" as const,
                text: opts.system,
                ...(opts.cacheSystem === false ? {} : { cache_control: { type: "ephemeral" as const } }),
              },
            ],
          }
        : {}),
      output_config: { effort: opts.effort, ...(format ? { format } : {}) },
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };

    const message = await client.beta.messages.stream(params).finalMessage();

    const iterations = (message.usage.iterations ?? null) as IterationUsage[] | null;
    const cost = computeCost(message.model, message.usage, iterations);
    const fallbackUsed = (iterations ?? []).some((it) => it.type === "fallback_message");

    if (options.onCost) {
      await options.onCost({
        provider: "anthropic",
        model: message.model,
        operation: opts.operation,
        units: cost.inputTokens + cost.outputTokens + cost.cacheReadTokens + cost.cacheWriteTokens,
        unitType: "tokens",
        costUsd: cost.costUsd,
        meta: {
          requestedModel: opts.model,
          effort: opts.effort,
          inputTokens: cost.inputTokens,
          outputTokens: cost.outputTokens,
          cacheReadTokens: cost.cacheReadTokens,
          cacheWriteTokens: cost.cacheWriteTokens,
          servedBy: cost.models,
          fallbackUsed,
          stopReason: message.stop_reason,
          ...(cost.unpricedModels.length ? { unpricedModels: cost.unpricedModels } : {}),
        },
      });
    }

    // Check stop_reason before reading content: a refusal can arrive with partial or empty content.
    if (message.stop_reason === "refusal") {
      const details = message.stop_details;
      throw new LlmRefusalError(details?.category ?? null, details?.explanation ?? null);
    }
    if (message.stop_reason === "max_tokens") throw new LlmTruncatedError(maxTokens);

    const text = message.content
      .filter((b): b is BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return { text, model: message.model, stopReason: message.stop_reason, fallbackUsed, cost, raw: message };
  }

  return {
    /** Free-form text generation. */
    generate: (opts: GenerateOptions) => run(opts),

    /** JSON output constrained to `schema` (structured outputs), validated again with Zod. */
    async generateStructured<S extends z.ZodType>(
      opts: GenerateOptions & { schema: S },
    ): Promise<StructuredResult<z.infer<S>>> {
      const result = await run(opts, betaZodOutputFormat(opts.schema));
      let json: unknown;
      try {
        json = JSON.parse(result.text);
      } catch (error) {
        throw new LlmParseError("Structured output was not valid JSON", {
          error: String(error),
          text: result.text.slice(0, 500),
        });
      }
      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) {
        throw new LlmParseError("Structured output failed schema validation", { issues: parsed.error.issues });
      }
      return { ...result, data: parsed.data };
    },
  };
}

export type Llm = ReturnType<typeof createLlm>;
