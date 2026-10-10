"use server";

import {
  buildDigestIssue,
  DomainError,
  getDigestIssue,
  itemKey,
  previousDigestPeriod,
  recordAudit,
  retryFailedDigestDeliveries,
  scheduleDigestIssue,
  sendDigestIssue,
  sendDigestTest,
  updateDigestIssue,
  type DigestItem,
} from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../../../lib/auth";
import { triggerTask } from "../../../lib/dispatch";

export type ActionState = { ok: boolean; message: string } | null;

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

async function guard(fn: () => Promise<string>): Promise<ActionState> {
  try {
    return { ok: true, message: await fn() };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Builds the issue for a locale and the Monday–Sunday week containing `week` (default: last week). */
export async function buildIssueAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const locale = str(f, "locale") ?? "en";
  const week = str(f, "week");
  let issueId: string | null = null;
  const result = await guard(async () => {
    const day = week ? new Date(`${week}T12:00:00Z`) : null;
    if (day && Number.isNaN(day.getTime())) throw new DomainError("invalid", "Pick a valid date");
    const period = previousDigestPeriod(day ? new Date(day.getTime() + 7 * 24 * 3600 * 1000) : new Date());
    const built = await buildDigestIssue(getDb(), {
      locale,
      ...period,
      rebuild: f.get("rebuild") === "on",
      createdByUserId: user.id,
    });
    if (!built) return `Nothing new was published in ${locale} between ${period.periodStart} and ${period.periodEnd}.`;
    issueId = built.issue.id;
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: built.created ? "newsletter.issue_create" : "newsletter.issue_rebuild",
      entityType: "newsletter_issue",
      entityId: built.issue.id,
      data: { locale, ...period },
    });
    return "Issue ready";
  });
  if (issueId) redirect(`/newsletter/${issueId}`);
  return result;
}

/** Subject, intro and the kept items in their new order (`keep_<key>` + `pos_<key>`). */
export async function updateIssueAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(f, "issueId") ?? "";
  return guard(async () => {
    const issue = await getDigestIssue(getDb(), id);
    if (!issue) throw new DomainError("not_found", "Issue not found");
    const items = issue.items as DigestItem[];
    const itemKeys = items
      .map((item, index) => ({ key: itemKey(item), index }))
      .filter(({ key }) => f.get(`keep_${key}`) === "on")
      .map(({ key, index }) => ({ key, pos: Number(str(f, `pos_${key}`) ?? index + 1) || index + 1, index }))
      .sort((a, b) => a.pos - b.pos || a.index - b.index)
      .map((x) => x.key);
    await updateDigestIssue(getDb(), id, { subject: str(f, "subject") ?? "", intro: str(f, "intro"), itemKeys });
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: "newsletter.issue_update",
      entityType: "newsletter_issue",
      entityId: id,
      data: { items: itemKeys.length },
    });
    revalidatePath(`/newsletter/${id}`);
    return "Saved";
  });
}

export async function sendTestAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  return guard(() => sendDigestTest(getDb(), str(f, "issueId") ?? "", user.email));
}

/** Sends on the worker (long lists); without Trigger.dev it sends inline, resumable if it times out. */
export async function sendNowAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(f, "issueId") ?? "";
  return guard(async () => {
    const issue = await getDigestIssue(getDb(), id);
    if (!issue) throw new DomainError("not_found", "Issue not found");
    if (f.get("confirm") !== "on")
      throw new DomainError("invalid", "Tick the box to confirm sending to all subscribers");
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: "newsletter.issue_send",
      entityType: "newsletter_issue",
      entityId: id,
    });
    const run = await triggerTask("newsletter-send", { issueId: id }, { tags: [`newsletter_${id}`] });
    if (run.ok) {
      // Leave scheduled/draft as is: the worker claims it. Show progress on reload.
      revalidatePath(`/newsletter/${id}`);
      return "Sending on the worker; reload to see progress.";
    }
    const result = await sendDigestIssue(getDb(), id);
    revalidatePath(`/newsletter/${id}`);
    revalidatePath("/newsletter");
    return result.message;
  });
}

/** `at` is a datetime-local value interpreted as UTC (the CMS shows times in UTC). */
export async function scheduleAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(f, "issueId") ?? "";
  const at = str(f, "at");
  return guard(async () => {
    const when = at ? new Date(`${at}:00Z`) : null;
    if (at && Number.isNaN(when!.getTime())) throw new DomainError("invalid", "Pick a valid time");
    await scheduleDigestIssue(getDb(), id, when);
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: when ? "newsletter.issue_schedule" : "newsletter.issue_unschedule",
      entityType: "newsletter_issue",
      entityId: id,
      data: { at: when?.toISOString() ?? null },
    });
    revalidatePath(`/newsletter/${id}`);
    return when ? `Scheduled for ${when.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Back to draft";
  });
}

export async function retryFailedAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(f, "issueId") ?? "";
  return guard(async () => {
    const n = await retryFailedDigestDeliveries(getDb(), id);
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: "newsletter.retry_failed",
      entityType: "newsletter_issue",
      entityId: id,
      data: { n },
    });
    revalidatePath(`/newsletter/${id}`);
    return n ? `${n} failed deliveries cleared; use "Send now" to retry them` : "No failed deliveries";
  });
}
