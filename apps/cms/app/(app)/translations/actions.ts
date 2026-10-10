"use server";

import {
  createTranslationJob,
  DomainError,
  recordAudit,
  setCategoryTranslation,
  setProductTranslation,
} from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";
import { dispatchJob } from "../../../lib/dispatch";

export type ActionState = { ok: boolean; message: string } | null;

async function queue(sourceArticleId: string, locale: string, userId: string, full: boolean) {
  const db = getDb();
  const { job, created } = await createTranslationJob(db, { sourceArticleId, locale, userId, trigger: "manual", full });
  if (!created) return { jobId: job.id, created, dispatched: "already running" };
  const dispatch = await dispatchJob(job.id);
  await recordAudit(db, {
    actorUserId: userId,
    action: "article.translate",
    entityType: "article",
    entityId: sourceArticleId,
    data: { locale, jobId: job.id, full },
  });
  return {
    jobId: job.id,
    created,
    dispatched: dispatch.mode === "trigger" ? "started" : `queued (${dispatch.reason})`,
  };
}

/** Translate or re-translate one English article (article page panel). */
export async function translateArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const sourceArticleId = String(form.get("sourceArticleId"));
  const locale = String(form.get("locale"));
  try {
    const res = await queue(sourceArticleId, locale, user.id, form.get("full") === "1");
    revalidatePath(`/articles/${String(form.get("articleId") ?? sourceArticleId)}`);
    revalidatePath("/translations");
    return {
      ok: true,
      message: res.created
        ? `Translation job ${res.dispatched}.`
        : "A translation job for this article is already running.",
    };
  } catch (error) {
    return { ok: false, message: error instanceof DomainError ? error.message : String(error).slice(0, 200) };
  }
}

/** Bulk "translate selected" from the coverage matrix. */
export async function translateSelectedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const locale = String(form.get("locale"));
  const ids = form.getAll("sourceArticleId").map(String).filter(Boolean);
  if (ids.length === 0) return { ok: false, message: "Select at least one article" };
  if (ids.length > 50) return { ok: false, message: "Select at most 50 articles at a time" };
  let created = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      if ((await queue(id, locale, user.id, false)).created) created++;
    } catch (error) {
      errors.push(error instanceof DomainError ? error.message : String(error).slice(0, 120));
    }
  }
  revalidatePath("/translations");
  return {
    ok: errors.length === 0,
    message: `${created} translation job(s) queued${ids.length - created - errors.length ? `, ${ids.length - created - errors.length} already running` : ""}${errors.length ? `; ${errors.length} failed: ${errors[0]}` : ""}.`,
  };
}

/** Saves editor-provided catalogue strings (category name/description, product tagline). */
export async function saveCatalogTranslationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const kind = String(form.get("kind"));
  const id = String(form.get("id"));
  const locale = String(form.get("locale"));
  const db = getDb();
  try {
    if (kind === "category") {
      await setCategoryTranslation(db, id, locale, {
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
      });
    } else if (kind === "product") {
      await setProductTranslation(db, id, locale, { tagline: String(form.get("tagline") ?? "") });
    } else return { ok: false, message: "Unknown item" };
    await recordAudit(db, {
      actorUserId: user.id,
      action: `${kind}.translation`,
      entityType: kind,
      entityId: id,
      data: { locale },
    });
    revalidatePath("/translations");
    return { ok: true, message: "Saved" };
  } catch (error) {
    return { ok: false, message: error instanceof DomainError ? error.message : String(error).slice(0, 200) };
  }
}
