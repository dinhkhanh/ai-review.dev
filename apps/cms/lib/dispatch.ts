import { setJobStatus } from "@repo/core";
import { eq, getDb, reviewJobs } from "@repo/db";
import type { ReviewStep } from "@repo/pipeline/editor";
import { auth, tasks } from "@trigger.dev/sdk";

export type DispatchResult = { mode: "trigger"; runId: string } | { mode: "queued"; reason: string };

/**
 * Hands a job to the Trigger.dev worker (docs/plan.md §4). Without a Trigger.dev key, or if the
 * call fails, the job stays queued for the local runner (`pnpm --filter worker runner`).
 */
export async function dispatchJob(
  jobId: string,
  opts: { fromStep?: ReviewStep; onlyStep?: ReviewStep } = {},
): Promise<DispatchResult> {
  const key = process.env.TRIGGER_SECRET_KEY;
  if (!key) return { mode: "queued", reason: "TRIGGER_SECRET_KEY is not set" };
  if (process.env.VERCEL_ENV === "production" && key.startsWith("tr_dev_")) {
    const reason = "TRIGGER_SECRET_KEY is a development key; set the Trigger.dev production key (tr_prod_…) on the CMS";
    await setJobStatus(getDb(), jobId, "queued", { error: `Dispatch skipped: ${reason}` });
    return { mode: "queued", reason };
  }
  // The SDK sends VERCEL_GIT_COMMIT_REF as a Trigger.dev branch on every Vercel deployment. That
  // only fits preview keys; with dev/prod keys the API rejects it ("No matching branch env").
  const previewBranch = key.startsWith("tr_preview_")
    ? (process.env.TRIGGER_PREVIEW_BRANCH ?? process.env.VERCEL_GIT_COMMIT_REF ?? "")
    : "";
  try {
    const handle = await auth.withAuth({ secretKey: key, previewBranch }, () =>
      tasks.trigger("review-product", { jobId, ...opts }, { tags: [`job_${jobId}`] }),
    );
    await getDb().update(reviewJobs).set({ runId: handle.id }).where(eq(reviewJobs.id, jobId));
    return { mode: "trigger", runId: handle.id };
  } catch (error) {
    await setJobStatus(getDb(), jobId, "queued", { error: `Dispatch failed: ${String(error).slice(0, 300)}` });
    return { mode: "queued", reason: String(error) };
  }
}
