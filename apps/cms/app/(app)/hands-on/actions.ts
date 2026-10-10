"use server";

import {
  createReviewJob,
  DomainError,
  handsOnEligibility,
  hasActiveJob,
  recordAudit,
  setHandsOnOptIn,
  setSetting,
} from "@repo/core";
import { eq, getDb, reviewJobs } from "@repo/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../../../lib/auth";
import { triggerTask } from "../../../lib/dispatch";

type State = { ok: boolean; message: string } | null;

const message = (error: unknown) => (error instanceof DomainError ? error.message : String(error).slice(0, 300));

/** Per-product opt-in (FR-RES-7). Turning it off never deletes past sessions or notes. */
export async function setOptInAction(form: FormData) {
  const user = await requireUser();
  const productId = String(form.get("productId"));
  const optIn = String(form.get("optIn")) === "true";
  try {
    await setHandsOnOptIn(getDb(), productId, optIn, user.id);
  } catch (error) {
    redirect(`/hands-on?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath("/hands-on");
}

/** Global switch `pipeline.handsOnTrials`; admin only because it lets the worker sign up for services. */
export async function setGlobalSwitchAction(form: FormData) {
  const user = await requireUser({ roles: ["admin"] });
  const on = String(form.get("on")) === "true";
  await setSetting(getDb(), "pipeline.handsOnTrials", on);
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "settings.update",
    entityType: "setting",
    entityId: "pipeline.handsOnTrials",
    data: { value: on },
  });
  revalidatePath("/hands-on");
}

/**
 * Starts a standalone trial: a `hands_on` job run by the worker task `hands-on-trial` (a browser
 * is needed, so it never runs inside the CMS). Without Trigger.dev the job stays queued for the
 * local runner.
 */
export async function startSessionAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireUser();
  const productId = String(form.get("productId"));
  const db = getDb();
  const eligibility = await handsOnEligibility(db, productId);
  if (!eligibility.eligible) return { ok: false, message: eligibility.reasons.join(". ") };
  if (await hasActiveJob(db, productId))
    return { ok: false, message: "A job is already queued or running for this product." };
  const job = await createReviewJob(db, {
    preset: "hands_on",
    productId,
    input: { productId },
    requestedByUserId: user.id,
  });
  await recordAudit(db, {
    actorUserId: user.id,
    action: "hands_on.start",
    entityType: "product",
    entityId: productId,
    data: { jobId: job.id },
  });
  const run = await triggerTask(
    "hands-on-trial",
    { jobId: job.id },
    { tags: [`job_${job.id}`, `product_${productId}`] },
  );
  if (run.ok) await db.update(reviewJobs).set({ runId: run.runId }).where(eq(reviewJobs.id, job.id));
  revalidatePath("/hands-on");
  const warnings = eligibility.warnings.length ? ` ${eligibility.warnings.join(" ")}` : "";
  return run.ok
    ? { ok: true, message: `Trial started on the worker (job ${job.id.slice(0, 8)}).${warnings}` }
    : { ok: true, message: `Job queued for the local runner: ${run.reason}.${warnings}` };
}
