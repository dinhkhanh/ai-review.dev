import { getJob, getSetting, jobCostStatus, notify, setJobStatus } from "@repo/core";
import type { DbOrTx } from "@repo/db";

/** Thrown when a job reaches its cost ceiling; the job waits for approval (FR-INT-6). */
export class JobPausedError extends Error {
  constructor(
    jobId: string,
    readonly totalUsd: number,
    readonly ceilingUsd: number,
  ) {
    super(`Job ${jobId} paused: spent $${totalUsd.toFixed(2)} of its $${ceilingUsd.toFixed(2)} ceiling`);
    this.name = "JobPausedError";
  }
}

/**
 * Checked before every fresh step: once the ledger total reaches the job's ceiling, the job moves
 * to `awaiting_approval` and the admin is notified. Approving raises the ceiling and re-queues it.
 */
export async function guardCostCeiling(db: DbOrTx, jobId: string) {
  const { total, ceiling, exceeded } = await jobCostStatus(db, jobId);
  if (!exceeded || ceiling === null) return;
  const error = `Paused at the cost ceiling: $${total.toFixed(2)} spent, ceiling $${ceiling.toFixed(2)}`;
  await setJobStatus(db, jobId, "awaiting_approval", { error });
  await notify(db, {
    event: "job.awaiting_approval",
    title: `Job paused at its $${ceiling.toFixed(2)} cost ceiling`,
    body: `${error}. Approve a higher ceiling to continue, or cancel the job.`,
    href: `/jobs/${jobId}`,
    entityType: "review_job",
    entityId: jobId,
    dedupeKey: `job.awaiting_approval:${jobId}:${ceiling.toFixed(2)}`,
  });
  throw new JobPausedError(jobId, total, ceiling);
}

function jobLabel(job: { input: unknown; preset: string }) {
  const input = (job.input ?? {}) as { name?: string | null; url?: string | null };
  return `${job.preset.replace(/_/g, " ")} — ${input.name || input.url || "product"}`;
}

/**
 * After a successful run: "job completed", plus a cost alert when the job cost more than the
 * per-review target × alert multiplier (NFR-6).
 */
export async function notifyJobSucceeded(db: DbOrTx, jobId: string, summary: string) {
  const job = await getJob(db, jobId);
  if (!job) return;
  const total = Number(job.totalCostUsd);
  await notify(db, {
    event: "job.succeeded",
    title: `Job completed: ${jobLabel(job)}`,
    body: `${summary} Cost $${total.toFixed(2)}.`,
    href: `/jobs/${jobId}`,
    entityType: "review_job",
    entityId: jobId,
    dedupeKey: `job.succeeded:${jobId}:${job.steps.length}`,
  });
  const [targets, multiplier] = await Promise.all([
    getSetting(db, "costs.targetPerReviewUsd"),
    getSetting(db, "costs.alertMultiplier"),
  ]);
  const target = job.preset === "full_review" ? (targets?.full ?? 12) : (targets?.quick ?? 5);
  const limit = target * (multiplier ?? 2);
  if (total > limit) {
    await notify(db, {
      event: "cost.alert",
      title: `Job cost $${total.toFixed(2)}, above the $${limit.toFixed(2)} alert line`,
      body: `Target $${target.toFixed(2)} × ${multiplier ?? 2}. See the per-step costs on the job page.`,
      href: `/jobs/${jobId}`,
      entityType: "review_job",
      entityId: jobId,
      dedupeKey: `cost.alert:${jobId}`,
    });
  }
}

/** Terminal failure (called once retries are exhausted, e.g. from the worker's onFailure hook). */
export async function notifyJobFailed(db: DbOrTx, jobId: string, error: unknown) {
  const job = await getJob(db, jobId);
  if (!job || job.status === "cancelled" || job.status === "awaiting_approval") return;
  const failedStep = [...job.steps].reverse().find((s) => s.status === "failed");
  const message = error instanceof Error ? error.message : String(error);
  await notify(db, {
    event: "job.failed",
    title: `Job failed${failedStep ? ` at ${failedStep.name}` : ""}: ${jobLabel(job)}`,
    body: message.slice(0, 1000),
    href: `/jobs/${jobId}`,
    entityType: "review_job",
    entityId: jobId,
    dedupeKey: `job.failed:${jobId}:${job.steps.length}`,
  });
}
