"use server";

import { acceptSuggestion, DomainError, recordAudit, setSuggestionStatus } from "@repo/core";
import { getDb } from "@repo/db";
import { evaluateCandidateUrl } from "@repo/pipeline/sourcing";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../../../lib/auth";
import { dispatchJob, triggerTask } from "../../../lib/dispatch";
import { cmsServices } from "../../../lib/services";

type State = { ok: boolean; message: string } | null;

const message = (error: unknown) => (error instanceof DomainError ? error.message : String(error).slice(0, 300));

/** FR-INT-7: one click from a suggestion into a review job. */
export async function acceptSuggestionAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("suggestionId"));
  let jobId: string;
  try {
    const job = await acceptSuggestion(getDb(), id, user.id);
    jobId = job.id;
  } catch (error) {
    redirect(`/suggestions?error=${encodeURIComponent(message(error))}`);
  }
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "suggestion.accept",
    entityType: "product_suggestion",
    entityId: id,
    data: { jobId },
  });
  await dispatchJob(jobId);
  redirect(`/jobs/${jobId}`);
}

export async function setSuggestionStatusAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("suggestionId"));
  const status = String(form.get("status")) === "new" ? "new" : "dismissed";
  try {
    await setSuggestionStatus(getDb(), id, status);
  } catch (error) {
    redirect(`/suggestions?error=${encodeURIComponent(message(error))}`);
  }
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: status === "new" ? "suggestion.restore" : "suggestion.dismiss",
    entityType: "product_suggestion",
    entityId: id,
  });
  revalidatePath("/suggestions");
}

/** Runs the sourcing task now on the worker, even when the daily schedule is off. */
export async function runSourcingNowAction(_prev: State, _form: FormData): Promise<State> {
  const user = await requireUser();
  const res = await triggerTask("product-sourcing-now", {}, { tags: ["sourcing"] });
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "sourcing.run",
    data: res.ok ? { runId: res.runId } : {},
  });
  return res.ok
    ? { ok: true, message: "Sourcing started on the worker; new suggestions appear here in a few minutes." }
    : { ok: false, message: `Could not start the worker task: ${res.reason}` };
}

/** Manual sourcing (FR-INT-7 lightweight version): evaluate one pasted website or Product Hunt URL. */
export async function addSuggestionAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireUser();
  const url = String(form.get("url") ?? "").trim();
  if (!url) return { ok: false, message: "Paste a product website or Product Hunt URL." };
  try {
    const { suggestion, created } = await evaluateCandidateUrl(cmsServices(), url);
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: "suggestion.add",
      entityType: "product_suggestion",
      entityId: suggestion?.id,
      data: { url },
    });
    revalidatePath("/suggestions");
    if (!suggestion) return { ok: false, message: "Could not save the suggestion." };
    return {
      ok: true,
      message: `${created ? "Added" : "Updated"} ${suggestion.name} (score ${Number(suggestion.score).toFixed(2)}${
        suggestion.status !== "new" ? `, already ${suggestion.status}` : ""
      }).`,
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}
