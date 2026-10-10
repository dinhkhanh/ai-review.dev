"use server";

import { dismissDecay, recordAudit, SEARCH_CONSOLE_MAX_BACKFILL_DAYS } from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";
import { triggerTask } from "../../../lib/dispatch";

type State = { ok: boolean; message: string } | null;

/** Runs the Search Console import (optionally a backfill) and decay detection on the worker. */
export async function importSearchConsoleNowAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireUser();
  const raw = Number(form.get("days") ?? 0);
  const days = Number.isInteger(raw) && raw > 0 ? Math.min(raw, SEARCH_CONSOLE_MAX_BACKFILL_DAYS) : undefined;
  const res = await triggerTask("search-console-import-now", days ? { days } : {}, { tags: ["search-console"] });
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "search_console.import",
    data: { days: days ?? null, ...(res.ok ? { runId: res.runId } : {}) },
  });
  return res.ok
    ? { ok: true, message: "Import started on the worker; figures update here in a few minutes." }
    : { ok: false, message: `Could not start the worker task: ${res.reason}` };
}

/** Accepts a drop (e.g. seasonal) and clears the flag; the article is not re-flagged for one window. */
export async function dismissDecayAction(form: FormData) {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  await dismissDecay(getDb(), [articleId]);
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "article.decay_dismiss",
    entityType: "article",
    entityId: articleId,
  });
  revalidatePath("/decay");
}
