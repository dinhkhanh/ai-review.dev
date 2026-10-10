"use server";

import { recordAudit, runLinkHealthChecks } from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";
import { triggerTask } from "../../../lib/dispatch";

export type ActionState = { ok: boolean; message: string } | null;

/** "Check now" for one link (FR-AFF-10): runs inline, it is a handful of HTTP requests. */
export async function checkLinkNowAction(form: FormData) {
  const user = await requireUser();
  const linkId = String(form.get("linkId") ?? "");
  const productId = String(form.get("productId") ?? "");
  if (!linkId) return;
  const db = getDb();
  await runLinkHealthChecks(db, { linkIds: [linkId], concurrency: 1 });
  await recordAudit(db, {
    actorUserId: user.id,
    action: "link.health_check",
    entityType: "affiliate_link",
    entityId: linkId,
  });
  if (productId) revalidatePath(`/products/${productId}`);
  revalidatePath("/affiliate");
}

/** Checks every active/pending link: on the worker when Trigger.dev is configured, inline otherwise. */
export async function checkAllLinksAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const db = getDb();
  await recordAudit(db, { actorUserId: user.id, action: "link.health_check_all", entityType: "affiliate_link" });
  const run = await triggerTask("link-health-now", {});
  if (run.ok) return { ok: true, message: "Health check started on the worker; refresh in a minute." };
  const result = await runLinkHealthChecks(db, { concurrency: 8 });
  revalidatePath("/affiliate");
  return {
    ok: true,
    message: `Checked ${result.checked} links: ${result.failed} failing, ${result.paused.length} paused.`,
  };
}
