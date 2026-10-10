import { setJobStatus } from "@repo/core";
import { eq, getDb, reviewJobs } from "@repo/db";
import type { ReviewStep } from "@repo/pipeline/editor";
import { tasks } from "@trigger.dev/sdk";

export type DispatchResult = { mode: "trigger"; runId: string } | { mode: "queued"; reason: string };

/**
 * Hands a job to the Trigger.dev worker (docs/plan.md §4). Without a Trigger.dev key, or if the
 * call fails, the job stays queued for the local runner (`pnpm --filter worker runner`).
 */
export async function dispatchJob(
  jobId: string,
  opts: { fromStep?: ReviewStep; onlyStep?: ReviewStep } = {},
): Promise<DispatchResult> {
  if (!process.env.TRIGGER_SECRET_KEY) return { mode: "queued", reason: "TRIGGER_SECRET_KEY is not set" };
  try {
    const handle = await tasks.trigger("review-product", { jobId, ...opts }, { tags: [`job_${jobId}`] });
    await getDb().update(reviewJobs).set({ runId: handle.id }).where(eq(reviewJobs.id, jobId));
    return { mode: "trigger", runId: handle.id };
  } catch (error) {
    await setJobStatus(getDb(), jobId, "queued", { error: `Dispatch failed: ${String(error).slice(0, 300)}` });
    return { mode: "queued", reason: String(error) };
  }
}
