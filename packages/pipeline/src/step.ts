import type { CostHandler, FirecrawlAdapter, Llm } from "@repo/ai";
import { costSink, finishStep, startStep } from "@repo/core";
import type { Database } from "@repo/db";
import type { z } from "zod";

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

/** Services a step may use. Steps never touch the database except through @repo/core. */
export interface StepServices {
  db: Database;
  /** Factory so each step gets clients whose cost events are attributed to that step. */
  makeLlm: (onCost: CostHandler) => Llm;
  makeFirecrawl: (onCost: CostHandler) => FirecrawlAdapter;
}

export interface StepContext {
  jobId: string;
  stepId: string;
  attempt: number;
  db: Database;
  llm: Llm;
  firecrawl: FirecrawlAdapter;
  log: (message: string, data?: Record<string, unknown>) => void;
}

export interface StepRunResult<O> {
  output: O;
  model?: string;
  effort?: string;
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
  log?: StepContext["log"];
}

/**
 * Runs one step with persistence (constraint C-3, NFR-4):
 * validates input -> records the attempt -> runs -> validates output -> stores output and usage.
 * If the same (job, step, attempt) already succeeded, returns the stored output without re-running.
 * Retries/backoff belong to the orchestrator (Trigger.dev); each retry is a new attempt number.
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

  const sink = costSink(services.db, { jobId: opts.jobId, stepId: row.id });
  const ctx: StepContext = {
    jobId: opts.jobId,
    stepId: row.id,
    attempt,
    db: services.db,
    llm: services.makeLlm(sink),
    firecrawl: services.makeFirecrawl(sink),
    log: opts.log ?? (() => {}),
  };

  try {
    const result = await step.run(ctx, input);
    const output = step.output.parse(result.output);
    await finishStep(services.db, row.id, {
      status: "succeeded",
      output,
      model: result.model,
      effort: result.effort,
      promptVersion: result.promptVersion,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    return output;
  } catch (error) {
    await finishStep(services.db, row.id, {
      status: "failed",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    throw error;
  }
}
