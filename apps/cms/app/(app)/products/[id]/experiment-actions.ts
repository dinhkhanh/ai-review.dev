"use server";

import { completeExperiment, DomainError, getExperiment, startExperiment, stopExperiment } from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../../lib/auth";
import { invalidateProductLinks } from "../../../../lib/cache";

export type ActionState = { ok: boolean; message: string } | null;

async function guard(fn: () => Promise<string>): Promise<ActionState> {
  try {
    return { ok: true, message: await fn() };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    throw error;
  }
}

/** After any experiment change the go-link table must reload (variant tagging, paused losers). */
async function refresh(productId: string) {
  await invalidateProductLinks(productId);
  revalidatePath(`/products/${productId}`);
  revalidatePath("/affiliate");
}

/** Starts an A/B offer test from the ticked links (FR-AFF-13). */
export async function startExperimentAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const productId = String(f.get("productId"));
  const linkIds = f.getAll("linkId").map(String);
  const weights: Record<string, number> = {};
  for (const id of linkIds) {
    const w = Number(f.get(`weight:${id}`) || 100);
    weights[id] = w;
  }
  return guard(async () => {
    const exp = await startExperiment(getDb(), {
      productId,
      name: String(f.get("name") ?? ""),
      linkIds,
      weights,
      notes: String(f.get("notes") ?? "").trim() || null,
      userId: user.id,
    });
    await refresh(productId);
    return `Started “${exp.name}”; new clicks split between ${linkIds.length} variants within a minute`;
  });
}

export async function stopExperimentAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(f.get("experimentId"));
  return guard(async () => {
    const exp = await stopExperiment(getDb(), id, { userId: user.id });
    await refresh(exp.productId);
    return "Stopped. Traffic keeps splitting by weight until you edit or pause links.";
  });
}

/** Promotes a winner (losers are paused). `allowInconclusive` must be ticked to override the report. */
export async function completeExperimentAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(f.get("experimentId"));
  return guard(async () => {
    const exp = await getExperiment(getDb(), id);
    if (!exp) throw new DomainError("not_found", "Experiment not found");
    const { paused } = await completeExperiment(getDb(), id, {
      winnerLinkId: String(f.get("winnerLinkId") ?? ""),
      allowInconclusive: f.get("allowInconclusive") === "on",
      userId: user.id,
    });
    await refresh(exp.productId);
    return `Winner promoted; ${paused.length} other variant${paused.length === 1 ? "" : "s"} paused`;
  });
}
