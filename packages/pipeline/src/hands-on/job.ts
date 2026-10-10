import { getJob, isJobCancelled, latestStepRuns, setJobStatus } from "@repo/core";
import { guardCostCeiling, JobPausedError, notifyJobSucceeded } from "../lifecycle";
import { executeStep, type StepServices } from "../step";
import { handsOnStep } from "./step";

/**
 * Runs a standalone "hands_on" job (FR-RES-7): one trial session, no article work. The notes land
 * as a research source that the product's next review or refresh uses. Like review jobs, a
 * succeeded step is reused on retry and the job pauses at its cost ceiling.
 */
export async function runHandsOnJob(
  services: StepServices,
  jobId: string,
  opts: { log?: (message: string, data?: Record<string, unknown>) => void } = {},
) {
  const job = await getJob(services.db, jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.preset !== "hands_on") throw new Error(`Job ${jobId} is a ${job.preset} job, not hands_on`);
  if (await isJobCancelled(services.db, jobId)) throw new Error(`Job ${jobId} was cancelled`);
  const productId = job.productId ?? (job.input as { productId?: string }).productId ?? null;
  await setJobStatus(services.db, jobId, "running", { error: null });
  try {
    if (!productId) throw new Error("A hands-on job needs a product");
    const latest = (await latestStepRuns(services.db, jobId)).get("hands_on");
    let out;
    if (latest?.status === "succeeded") out = handsOnStep.output.parse(latest.output);
    else {
      await guardCostCeiling(services.db, jobId);
      out = await executeStep(
        services,
        handsOnStep,
        { productId, required: true },
        { jobId, attempt: (latest?.attempt ?? 0) + 1, log: opts.log },
      );
    }
    await setJobStatus(services.db, jobId, "succeeded", { error: null });
    await notifyJobSucceeded(
      services.db,
      jobId,
      `Hands-on trial ${out.status}${out.stopReason ? ` (${out.stopReason})` : ""}.`,
    );
    return { jobId, productId, sessionId: out.sessionId, status: out.status, stopReason: out.stopReason };
  } catch (error) {
    if (error instanceof JobPausedError) throw error;
    await setJobStatus(services.db, jobId, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
