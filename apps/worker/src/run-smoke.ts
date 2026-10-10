import { createReviewJob, getJob, setJobStatus } from "@repo/core";
import type { Database } from "@repo/db";
import { createStepServices, executeStep, smokeStep, type StepServices } from "@repo/pipeline";

export interface SmokeOptions {
  message: string;
  useLlm: boolean;
  attempt?: number;
  runId?: string;
  log?: (message: string, data?: Record<string, unknown>) => void;
  services?: StepServices;
}

/**
 * Phase 0 end-to-end check shared by the Trigger.dev task and the local CLI: creates a job,
 * runs the smoke step through the real executor, and records status and costs.
 */
export async function runPipelineSmoke(db: Database, opts: SmokeOptions) {
  const job = await createReviewJob(db, { preset: "quick_review", input: { smoke: true, message: opts.message } });
  await setJobStatus(db, job.id, "running", { runId: opts.runId });
  try {
    const output = await executeStep(
      opts.services ?? createStepServices(db),
      smokeStep,
      { message: opts.message, useLlm: opts.useLlm },
      {
        jobId: job.id,
        attempt: opts.attempt ?? 1,
        log: opts.log,
      },
    );
    await setJobStatus(db, job.id, "succeeded");
    return { jobId: job.id, output, job: await getJob(db, job.id) };
  } catch (error) {
    await setJobStatus(db, job.id, "failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
