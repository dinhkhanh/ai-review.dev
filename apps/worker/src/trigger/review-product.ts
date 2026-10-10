import { getDb } from "@repo/db";
import { createStepServices, JobCancelledError, REVIEW_STEPS, runReviewJob } from "@repo/pipeline";
import { AbortTaskRunError, logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

/**
 * Runs one review job (docs/plan.md §4 "Pipeline run"). Triggered by the CMS with the job id.
 * Retries resume from the last succeeded step: every step is persisted and idempotent (C-3).
 */
export const reviewProduct = schemaTask({
  id: "review-product",
  schema: z.object({
    jobId: z.uuid(),
    fromStep: z.enum(REVIEW_STEPS).optional(),
    onlyStep: z.enum(REVIEW_STEPS).optional(),
  }),
  queue: { concurrencyLimit: 5 },
  maxDuration: 3600,
  run: async (payload, { ctx }) => {
    const db = getDb();
    try {
      const result = await runReviewJob(createStepServices(db), payload.jobId, {
        // Only the first attempt honours re-run flags; retries resume.
        ...(ctx.attempt.number === 1 ? { fromStep: payload.fromStep, onlyStep: payload.onlyStep } : {}),
        log: (message, data) => logger.info(message, data),
      });
      return { articleId: result.articleId, hardGatesPassed: result.qa.hardGatesPassed };
    } catch (error) {
      if (error instanceof JobCancelledError) throw new AbortTaskRunError(error.message);
      throw error;
    }
  },
});
