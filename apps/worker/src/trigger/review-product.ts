import { getDb } from "@repo/db";
import {
  createStepServices,
  JobCancelledError,
  DERIVATIVE_STEPS,
  JobPausedError,
  notifyJobFailed,
  REVIEW_STEPS,
  runReviewJob,
  TRANSLATE_STEPS,
  type ReviewStep,
} from "@repo/pipeline";
import { AbortTaskRunError, logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { createPlaywrightDriver } from "../browser/playwright-driver";

/** Steps of review, derivative and translate jobs (re-run targets). */
const ALL_STEPS = [...new Set([...REVIEW_STEPS, ...DERIVATIVE_STEPS, ...TRANSLATE_STEPS])] as [string, ...string[]];

/**
 * Runs one review job (docs/plan.md §4 "Pipeline run"). Triggered by the CMS with the job id.
 * Retries resume from the last succeeded step: every step is persisted and idempotent (C-3).
 */
export const reviewProduct = schemaTask({
  id: "review-product",
  schema: z.object({
    jobId: z.uuid(),
    fromStep: z.enum(ALL_STEPS).optional(),
    onlyStep: z.enum(ALL_STEPS).optional(),
  }),
  queue: { concurrencyLimit: 5 },
  maxDuration: 3600,
  run: async (payload, { ctx }) => {
    const db = getDb();
    try {
      // The browser is used only by the hands_on step of opted-in products (FR-RES-7).
      const services = { ...createStepServices(db), makeBrowser: () => createPlaywrightDriver() };
      const result = await runReviewJob(services, payload.jobId, {
        // Only the first attempt honours re-run flags; retries resume.
        ...(ctx.attempt.number === 1
          ? {
              fromStep: payload.fromStep as ReviewStep | undefined,
              onlyStep: payload.onlyStep as ReviewStep | undefined,
            }
          : {}),
        log: (message, data) => logger.info(message, data),
      });
      return {
        articleId: result.articleId,
        outcome: result.outcome,
        hardGatesPassed: result.qa?.hardGatesPassed ?? null,
      };
    } catch (error) {
      // Cancelled or paused at the cost ceiling (FR-INT-6): retrying would not help.
      if (error instanceof JobCancelledError || error instanceof JobPausedError) {
        throw new AbortTaskRunError(error.message);
      }
      throw error;
    }
  },
  // Runs once, after the last retry failed (FR-CMS-8 "step failed").
  onFailure: async ({ payload, error }) => {
    await notifyJobFailed(getDb(), payload.jobId, error);
  },
});
