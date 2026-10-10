import type { CostHandler, Embedder, Effort, FirecrawlAdapter, Llm } from "@repo/ai";
import { appendStepLogs, costSink, finishStep, latestStepRuns, startStep } from "@repo/core";
import { eq, reviewJobs, type Database } from "@repo/db";
import type { StorageDriver } from "@repo/media";
import type { z } from "zod";
import { resolvePrompt, type PromptKey, type ResolvedPrompt } from "./prompts";

/** Pipeline step names in execution order (docs/plan.md §5, SRS §7). */
export const STEP_NAMES = [
  "resolve_product",
  "crawl_official",
  "collect_third_party",
  "chunk_embed",
  "extract_facts",
  "fact_sheet",
  "affiliate_discovery",
  "competitors",
  "seo_brief",
  "write",
  "fact_check",
  "style_pass",
  "graphics",
  "qa_gates",
  "publish",
  "video_script",
  "tts",
  "render",
  "youtube",
  "smoke",
] as const;
export type StepName = (typeof STEP_NAMES)[number];

/** Services a step may use. Steps touch the database only through @repo/core (and @repo/media). */
export interface StepServices {
  db: Database;
  /** Factories so each step gets clients whose cost events are attributed to that step. */
  makeLlm: (onCost: CostHandler) => Llm;
  makeFirecrawl: (onCost: CostHandler) => FirecrawlAdapter;
  makeEmbedder?: (onCost: CostHandler) => Embedder | null;
  storage?: StorageDriver;
  /** HTTP for robots.txt, logos and screenshots; injectable for tests. */
  fetch?: typeof fetch;
}

export interface StepContext {
  jobId: string;
  stepId: string;
  attempt: number;
  db: Database;
  llm: Llm;
  firecrawl: FirecrawlAdapter;
  embedder: Embedder | null;
  storage: StorageDriver | null;
  fetch: typeof fetch;
  /** The job's raw intake (FR-INT-1). */
  jobInput: Record<string, unknown>;
  log: (message: string, data?: Record<string, unknown>) => void;
  /** Latest succeeded output of an earlier step in this job (SRS §7: steps read persisted outputs). */
  previous: <T = unknown>(step: StepName) => Promise<T | null>;
  /** Prompt text + model/effort after CMS overrides (C-5, FR-CMS-7). */
  prompt: (key: PromptKey) => Promise<ResolvedPrompt>;
}

export interface StepRunResult<O> {
  output: O;
  model?: string;
  effort?: Effort | string;
  promptVersion?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface StepDefinition<I extends z.ZodType, O extends z.ZodType> {
  name: StepName;
  input: I;
  output: O;
  run: (ctx: StepContext, input: z.infer<I>) => Promise<StepRunResult<z.infer<O>>>;
}

export function defineStep<I extends z.ZodType, O extends z.ZodType>(def: StepDefinition<I, O>): StepDefinition<I, O> {
  return def;
}

export interface ExecuteOptions {
  jobId: string;
  attempt?: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

/** Sums token usage reported by the LLM wrapper's cost events, for the step row. */
function usageTracker(sink: CostHandler) {
  const usage = { tokensIn: 0, tokensOut: 0, models: new Set<string>() };
  const handler: CostHandler = async (event) => {
    if (event.provider === "anthropic") {
      usage.tokensIn += Number(event.meta?.inputTokens ?? 0) + Number(event.meta?.cacheReadTokens ?? 0);
      usage.tokensOut += Number(event.meta?.outputTokens ?? 0);
      if (event.model) usage.models.add(event.model);
    }
    await sink(event);
  };
  return { usage, handler };
}

/**
 * Runs one step with persistence (constraint C-3, NFR-4):
 * validates input -> records the attempt -> runs -> validates output -> stores output and usage.
 * If the same (job, step, attempt) already succeeded, returns the stored output without re-running.
 */
export async function executeStep<I extends z.ZodType, O extends z.ZodType>(
  services: StepServices,
  step: StepDefinition<I, O>,
  rawInput: unknown,
  opts: ExecuteOptions,
): Promise<z.infer<O>> {
  const input = step.input.parse(rawInput);
  const attempt = opts.attempt ?? 1;
  const { step: row, alreadyDone } = await startStep(services.db, opts.jobId, step.name, input, attempt);
  if (alreadyDone) return step.output.parse(row.output);

  const { usage, handler } = usageTracker(costSink(services.db, { jobId: opts.jobId, stepId: row.id }));
  const [job] = await services.db
    .select({ input: reviewJobs.input })
    .from(reviewJobs)
    .where(eq(reviewJobs.id, opts.jobId));
  const logs: Array<{ ts: string; message: string; data?: Record<string, unknown> }> = [];
  const ctx: StepContext = {
    jobId: opts.jobId,
    stepId: row.id,
    attempt,
    db: services.db,
    llm: services.makeLlm(handler),
    firecrawl: services.makeFirecrawl(handler),
    embedder: services.makeEmbedder?.(handler) ?? null,
    storage: services.storage ?? null,
    fetch: services.fetch ?? fetch,
    jobInput: (job?.input ?? {}) as Record<string, unknown>,
    log: (message, data) => {
      logs.push({ ts: new Date().toISOString(), message, ...(data ? { data } : {}) });
      opts.log?.(`[${step.name}] ${message}`, data);
    },
    previous: async <T>(name: StepName) => {
      const latest = (await latestStepRuns(services.db, opts.jobId)).get(name);
      return latest && (latest.status === "succeeded" || latest.status === "stale") ? (latest.output as T) : null;
    },
    prompt: (key) => resolvePrompt(services.db, key),
  };

  try {
    const result = await step.run(ctx, input);
    const output = step.output.parse(result.output);
    await appendStepLogs(services.db, row.id, logs);
    await finishStep(services.db, row.id, {
      status: "succeeded",
      output,
      model: result.model ?? (usage.models.size ? [...usage.models].join(",") : undefined),
      effort: result.effort,
      promptVersion: result.promptVersion,
      tokensIn: result.tokensIn ?? usage.tokensIn,
      tokensOut: result.tokensOut ?? usage.tokensOut,
    });
    return output;
  } catch (error) {
    await appendStepLogs(services.db, row.id, logs).catch(() => {});
    await finishStep(services.db, row.id, {
      status: "failed",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
    });
    throw error;
  }
}

/** Runs `fn` over items with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
