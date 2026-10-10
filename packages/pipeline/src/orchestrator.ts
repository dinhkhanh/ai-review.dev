import {
  findArticleForProduct,
  getJob,
  isJobCancelled,
  latestStepRuns,
  markArticleVerified,
  markStepsStale,
  scheduleNextRefresh,
  setJobStatus,
} from "@repo/core";
import type { z } from "zod";
import { guardCostCeiling, JobPausedError, notifyJobSucceeded } from "./lifecycle";
import { DERIVATIVE_PRESETS, stepsForPreset, type DerivativeStep, type ReviewStep } from "./review-steps";
import { executeStep, type StepDefinition, type StepServices } from "./step";
import { affiliateDiscoveryStep } from "./steps/affiliate-discovery";
import { chunkEmbedStep } from "./steps/chunk-embed";
import { collectThirdPartyStep } from "./steps/collect-third-party";
import { competitorsStep } from "./steps/competitors";
import { crawlOfficialStep } from "./steps/crawl-official";
import {
  derivativeBriefStep,
  derivativeInputSchema,
  derivativePrepareStep,
  derivativeWriteStep,
} from "./steps/derivatives";
import { extractFactsStep } from "./steps/extract-facts";
import { factCheckStep } from "./steps/fact-check";
import { factSheetStep } from "./steps/fact-sheet";
import { graphicsStep } from "./steps/graphics";
import { publishDecisionStep } from "./steps/publish-decision";
import { qaGatesStep } from "./steps/qa-gates";
import { refreshPlanStep, refreshRewriteStep } from "./steps/refresh";
import { resolveProductStep } from "./steps/resolve-product";
import { seoBriefStep } from "./steps/seo-brief";
import { siteCheckStep } from "./steps/site-check";
import { socialStep } from "./steps/social";
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
  fromStep?: ReviewStep | DerivativeStep;
  /** Re-run only this step (downstream outputs are kept). */
  onlyStep?: ReviewStep | DerivativeStep;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export {
  DERIVATIVE_STEPS,
  REVIEW_STEPS,
  prepareRerun,
  stepsForPreset,
  type DerivativeStep,
  type ReviewStep,
} from "./review-steps";

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
  const steps = stepsForPreset(job.preset);
  if (opts.fromStep && steps.includes(opts.fromStep))
    await markStepsStale(services.db, jobId, steps.slice(steps.indexOf(opts.fromStep)));
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
    await guardCostCeiling(services.db, jobId);
    const attempt = (latest?.attempt ?? 0) + 1;
    opts.log?.(`▶ ${step.name} (attempt ${attempt})`);
    const out = await executeStep(services, step, stepInput, { jobId, attempt, log: opts.log });
    outputs.set(step.name, out);
    return out;
  }

  /** Steps whose failure never blocks the article (SRS §7): affiliate discovery, graphics, social. */
  async function optional<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof JobCancelledError || error instanceof JobPausedError) throw error;
      opts.log?.(`✖ ${name} failed (non-critical): ${String(error)}`);
      return null;
    }
  }

  /** Shared tail: graphics, QA gates, social posts, then publish or hand over for review. */
  async function finishArticle(articleId: string, label: string) {
    await optional("graphics", () => run(graphicsStep, { articleId }));
    const qa = await run(qaGatesStep, { articleId });
    await optional("social", () => run(socialStep, { articleId }));
    const decision = await run(publishDecisionStep, { articleId });
    await setJobStatus(services.db, jobId, "succeeded", { error: null });
    await notifyJobSucceeded(
      services.db,
      jobId,
      `${label} ${decision.action === "review" ? "is waiting for review" : decision.action}.`,
    );
    return { jobId, articleId, qa, outcome: decision.action };
  }

  try {
    // Comparisons, alternatives and best-of lists are written from existing research (FR-CON-8).
    if ((DERIVATIVE_PRESETS as readonly string[]).includes(job.preset)) {
      const intake = derivativeInputSchema.parse({ ...job.input, kind: job.preset });
      await run(derivativePrepareStep, intake);
      await run(derivativeBriefStep, { angle: intake.angle, keywords: intake.keywords });
      const written = await run(derivativeWriteStep, {});
      await run(factCheckStep, { articleId: written.articleId });
      await run(stylePassStep, { articleId: written.articleId });
      return { ...(await finishArticle(written.articleId, "Article")), productId: null };
    }

    const resolved = await run(resolveProductStep, {
      url: input.url ?? null,
      name: input.name ?? null,
      categorySlug: input.categorySlug ?? null,
      productId: input.productId ?? job.productId ?? null,
    });
    const productId = resolved.productId;

    // Refresh of a live article (FR-MNT-1): check the site, re-research, rewrite only what changed.
    const existing = job.preset === "refresh" ? await findArticleForProduct(services.db, productId) : null;
    const refreshing = !!existing?.publishedVersionId;
    if (refreshing) {
      const site = await run(siteCheckStep, { productId, attempts: 3, retryDelayMs: 5000 });
      if (site.discontinued) {
        await setJobStatus(services.db, jobId, "succeeded", { error: null });
        await notifyJobSucceeded(services.db, jobId, `Site ${site.detail}; product marked discontinued.`);
        return { jobId, productId, articleId: existing.id, qa: null, outcome: "discontinued" as const };
      }
    }

    await Promise.all([
      run(crawlOfficialStep, { productId, maxPages: 15 }),
      run(collectThirdPartyStep, { productId }),
      optional("affiliate_discovery", () => run(affiliateDiscoveryStep, { productId })),
    ]);
    await run(chunkEmbedStep, { productId });
    await run(extractFactsStep, { productId });
    await run(factSheetStep, { productId });
    await scheduleNextRefresh(services.db, productId);

    let articleId: string;
    if (refreshing) {
      articleId = existing.id;
      const plan = await run(refreshPlanStep, { productId });
      if (!plan.material) {
        await markArticleVerified(services.db, articleId);
        await setJobStatus(services.db, jobId, "succeeded", { error: null });
        await notifyJobSucceeded(services.db, jobId, "Refresh found no material changes; facts re-verified.");
        return { jobId, productId, articleId, qa: null, outcome: "verified" as const };
      }
      await run(refreshRewriteStep, { articleId });
      await run(factCheckStep, { articleId });
    } else {
      await run(competitorsStep, { productId, hints: input.competitors ?? [] });
      await run(seoBriefStep, { productId });
      const written = await run(writeStep, { productId });
      articleId = written.articleId;
      await run(factCheckStep, { articleId });
      await run(stylePassStep, { articleId });
    }
    return { ...(await finishArticle(articleId, refreshing ? "Refresh" : "Article")), productId };
  } catch (error) {
    if (error instanceof JobCancelledError || error instanceof JobPausedError) throw error;
    await setJobStatus(services.db, jobId, "failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
