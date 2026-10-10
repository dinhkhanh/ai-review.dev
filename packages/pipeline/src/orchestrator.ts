import { getJob, isJobCancelled, latestStepRuns, markStepsStale, setJobStatus } from "@repo/core";
import type { z } from "zod";
import { REVIEW_STEPS, type ReviewStep } from "./review-steps";
import { executeStep, type StepDefinition, type StepServices } from "./step";
import { affiliateDiscoveryStep } from "./steps/affiliate-discovery";
import { chunkEmbedStep } from "./steps/chunk-embed";
import { collectThirdPartyStep } from "./steps/collect-third-party";
import { competitorsStep } from "./steps/competitors";
import { crawlOfficialStep } from "./steps/crawl-official";
import { extractFactsStep } from "./steps/extract-facts";
import { factCheckStep } from "./steps/fact-check";
import { factSheetStep } from "./steps/fact-sheet";
import { graphicsStep } from "./steps/graphics";
import { qaGatesStep } from "./steps/qa-gates";
import { resolveProductStep } from "./steps/resolve-product";
import { seoBriefStep } from "./steps/seo-brief";
import { stylePassStep } from "./steps/style-pass";
import { writeStep } from "./steps/write";

/** Intake stored on review_jobs.input (FR-INT-1). */
export interface JobInput {
  url?: string | null;
  name?: string | null;
  categorySlug?: string | null;
  keywords?: string[];
  angle?: string | null;
  competitors?: string[];
  productId?: string | null;
}

export interface RunOptions {
  /** Re-run this step and everything after it, even if they succeeded before. */
  fromStep?: ReviewStep;
  /** Re-run only this step (downstream outputs are kept). */
  onlyStep?: ReviewStep;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export { REVIEW_STEPS, prepareRerun, type ReviewStep } from "./review-steps";

export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was cancelled`);
    this.name = "JobCancelledError";
  }
}

/**
 * Runs (or resumes) a review job. Each step's latest succeeded attempt is reused, so a crashed or
 * retried run continues where it stopped (C-3, NFR-4); failed, stale or interrupted attempts get a
 * fresh attempt number, so no (job, step, attempt) runs twice.
 */
export async function runReviewJob(services: StepServices, jobId: string, opts: RunOptions = {}) {
  const job = await getJob(services.db, jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === "cancelled") throw new JobCancelledError(jobId);
  if (opts.fromStep) await markStepsStale(services.db, jobId, REVIEW_STEPS.slice(REVIEW_STEPS.indexOf(opts.fromStep)));
  if (opts.onlyStep) await markStepsStale(services.db, jobId, [opts.onlyStep]);
  await setJobStatus(services.db, jobId, "running", { error: null });

  const input = job.input as JobInput;
  const outputs = new Map<string, unknown>();

  async function run<I extends z.ZodType, O extends z.ZodType>(step: StepDefinition<I, O>, stepInput: z.infer<I>) {
    if (await isJobCancelled(services.db, jobId)) throw new JobCancelledError(jobId);
    const latest = (await latestStepRuns(services.db, jobId)).get(step.name);
    if (latest?.status === "succeeded") {
      const out = step.output.parse(latest.output);
      outputs.set(step.name, out);
      return out as z.infer<O>;
    }
    const attempt = (latest?.attempt ?? 0) + 1;
    opts.log?.(`▶ ${step.name} (attempt ${attempt})`);
    const out = await executeStep(services, step, stepInput, { jobId, attempt, log: opts.log });
    outputs.set(step.name, out);
    return out;
  }

  /** Steps whose failure never blocks the article (SRS §7): affiliate discovery and graphics. */
  async function optional<T>(name: ReviewStep, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof JobCancelledError) throw error;
      opts.log?.(`✖ ${name} failed (non-critical): ${String(error)}`);
      return null;
    }
  }

  try {
    const resolved = await run(resolveProductStep, {
      url: input.url ?? null,
      name: input.name ?? null,
      categorySlug: input.categorySlug ?? null,
      productId: input.productId ?? job.productId ?? null,
    });
    const productId = resolved.productId;
    await Promise.all([
      run(crawlOfficialStep, { productId, maxPages: 15 }),
      run(collectThirdPartyStep, { productId }),
      optional("affiliate_discovery", () => run(affiliateDiscoveryStep, { productId })),
    ]);
    await run(chunkEmbedStep, { productId });
    await run(extractFactsStep, { productId });
    await run(factSheetStep, { productId });
    await run(competitorsStep, { productId, hints: input.competitors ?? [] });
    await run(seoBriefStep, { productId });
    const written = await run(writeStep, { productId });
    const articleId = written.articleId;
    await run(factCheckStep, { articleId });
    await run(stylePassStep, { articleId });
    await optional("graphics", () => run(graphicsStep, { articleId }));
    const qa = await run(qaGatesStep, { articleId });
    await setJobStatus(services.db, jobId, "succeeded", { error: null });
    return { jobId, productId, articleId, qa };
  } catch (error) {
    if (error instanceof JobCancelledError) throw error;
    await setJobStatus(services.db, jobId, "failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
