"use server";

import { approveJobOverCeiling, cancelJob, DomainError, getJob, recordAudit, requeueJob } from "@repo/core";
import { getDb } from "@repo/db";
import { prepareRerun, stepsForPreset, type ReviewStep } from "@repo/pipeline/editor";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";
import { dispatchJob } from "../../../lib/dispatch";

function asStep(value: FormDataEntryValue | null, preset: string): ReviewStep | null {
  const s = String(value ?? "");
  return stepsForPreset(preset).includes(s) ? (s as ReviewStep) : null;
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
  const job = await getJob(getDb(), jobId);
  if (!job) return;
  const step = asStep(formData.get("step"), job.preset);
  if (!step) return;
  const only = formData.get("only") === "1";
  await prepareRerun(getDb(), jobId, step, only, job.preset);
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

/** Continue a job paused at its cost ceiling with a higher ceiling (FR-INT-6). */
export async function approveCeilingAction(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const jobId = String(formData.get("jobId"));
  const ceiling = Number(formData.get("ceiling"));
  if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling > 500) {
    return { ok: false, message: "Enter a ceiling between $0 and $500." };
  }
  try {
    await approveJobOverCeiling(getDb(), jobId, ceiling);
  } catch (error) {
    return { ok: false, message: error instanceof DomainError ? error.message : String(error) };
  }
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "job.approve_ceiling",
    entityType: "review_job",
    entityId: jobId,
    data: { ceiling },
  });
  const dispatched = await dispatchJob(jobId);
  revalidatePath(`/jobs/${jobId}`);
  return {
    ok: true,
    message:
      dispatched.mode === "trigger" ? "Approved; the job continues." : `Approved; queued (${dispatched.reason}).`,
  };
}
