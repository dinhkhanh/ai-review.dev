"use server";

import { cancelJob, recordAudit, requeueJob } from "@repo/core";
import { getDb } from "@repo/db";
import { prepareRerun, REVIEW_STEPS, type ReviewStep } from "@repo/pipeline/editor";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";
import { dispatchJob } from "../../../lib/dispatch";

function asStep(value: FormDataEntryValue | null): ReviewStep | null {
  const s = String(value ?? "");
  return (REVIEW_STEPS as readonly string[]).includes(s) ? (s as ReviewStep) : null;
}

/** Retry: resume from the failed step; succeeded steps are reused (FR-CMS-3). */
export async function retryJob(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId"));
  await requeueJob(getDb(), jobId);
  await recordAudit(getDb(), { actorUserId: user.id, action: "job.retry", entityType: "review_job", entityId: jobId });
  await dispatchJob(jobId);
  revalidatePath(`/jobs/${jobId}`);
}

/** Re-run from a step (that step and everything after it), or only that step. */
export async function rerunJob(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId"));
  const step = asStep(formData.get("step"));
  if (!step) return;
  const only = formData.get("only") === "1";
  await prepareRerun(getDb(), jobId, step, only);
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: only ? "job.rerun_step" : "job.rerun_from",
    entityType: "review_job",
    entityId: jobId,
    data: { step },
  });
  await dispatchJob(jobId);
  revalidatePath(`/jobs/${jobId}`);
}

export async function cancelJobAction(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId"));
  await cancelJob(getDb(), jobId);
  await recordAudit(getDb(), { actorUserId: user.id, action: "job.cancel", entityType: "review_job", entityId: jobId });
  revalidatePath(`/jobs/${jobId}`);
}
