import { setJobStatus } from "@repo/core";
import { eq, getDb, reviewJobs } from "@repo/db";
import type { ReviewStep } from "@repo/pipeline/editor";
import { auth, tasks } from "@trigger.dev/sdk";

export type DispatchResult = { mode: "trigger"; runId: string } | { mode: "queued"; reason: string };

/** Why a Trigger.dev key cannot be used from this deployment, or null when it can. */
function keyProblem(key: string | undefined): string | null {
  if (!key) return "TRIGGER_SECRET_KEY is not set";
  if (process.env.VERCEL_ENV === "production" && key.startsWith("tr_dev_")) {
    return "TRIGGER_SECRET_KEY is a development key; set the Trigger.dev production key (tr_prod_…) on the CMS";
  }
  return null;
}

/**
 * Triggers any worker task by id (video, sourcing, imports...). The SDK sends
 * VERCEL_GIT_COMMIT_REF as a Trigger.dev branch on every Vercel deployment; that only fits preview
 * keys, so it is cleared for dev/prod keys ("No matching branch env" otherwise).
 */
export async function triggerTask(
  taskId: string,
  payload: Record<string, unknown>,
  opts: { tags?: string[] } = {},
): Promise<{ ok: true; runId: string } | { ok: false; reason: string }> {
  const key = process.env.TRIGGER_SECRET_KEY;
  const problem = keyProblem(key);
  if (problem) return { ok: false, reason: problem };
  const previewBranch = key!.startsWith("tr_preview_")
    ? (process.env.TRIGGER_PREVIEW_BRANCH ?? process.env.VERCEL_GIT_COMMIT_REF ?? "")
    : "";
  try {
    const handle = await auth.withAuth({ secretKey: key!, previewBranch }, () =>
      tasks.trigger(taskId, payload, { tags: opts.tags }),
    );
    return { ok: true, runId: handle.id };
  } catch (error) {
    return { ok: false, reason: String(error).slice(0, 300) };
  }
}

/**
 * Hands a job to the Trigger.dev worker (docs/plan.md §4). Without a Trigger.dev key, or if the
 * call fails, the job stays queued for the local runner (`pnpm --filter worker runner`).
 */
export async function dispatchJob(
  jobId: string,
  opts: { fromStep?: ReviewStep; onlyStep?: ReviewStep } = {},
): Promise<DispatchResult> {
  const key = process.env.TRIGGER_SECRET_KEY;
  const problem = keyProblem(key);
  if (problem) {
    if (key) await setJobStatus(getDb(), jobId, "queued", { error: `Dispatch skipped: ${problem}` });
    return { mode: "queued", reason: problem };
  }
  const result = await triggerTask("review-product", { jobId, ...opts }, { tags: [`job_${jobId}`] });
  if (!result.ok) {
    await setJobStatus(getDb(), jobId, "queued", { error: `Dispatch failed: ${result.reason}` });
    return { mode: "queued", reason: result.reason };
  }
  await getDb().update(reviewJobs).set({ runId: result.runId }).where(eq(reviewJobs.id, jobId));
  return { mode: "trigger", runId: result.runId };
}
