"use server";

import { createReviewJob, findProductByDomain, listCategories, parseBulkIntake, recordAudit } from "@repo/core";
import { getDb } from "@repo/db";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "../../../../lib/auth";
import { dispatchJob } from "../../../../lib/dispatch";

export type BulkState = { ok: boolean; message: string } | null;

const formSchema = z.object({
  list: z.string().max(100_000),
  preset: z.enum(["quick_review", "full_review"]).default("quick_review"),
  categorySlug: z.string().trim().optional(),
  costCeilingUsd: z.coerce
    .number()
    .positive()
    .max(100)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  refreshExisting: z.string().optional(),
});

/**
 * Bulk intake (FR-INT-2): one job per product, grouped by a batch id. Existing products get a
 * refresh job when "refresh existing" is ticked and are skipped otherwise (FR-INT-4).
 */
export async function submitBulkIntake(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const user = await requireUser();
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  const db = getDb();
  const { rows, errors } = parseBulkIntake(parsed.data.list);
  if (rows.length === 0) {
    return {
      ok: false,
      message: errors.length
        ? `No valid rows. ${errors.map((e) => `Line ${e.line}: ${e.message}`).join("; ")}`
        : "Paste at least one product.",
    };
  }
  const categories = new Set((await listCategories(db)).map((c) => c.slug));
  const batchId = randomUUID();
  const skipped: string[] = [];
  const jobIds: string[] = [];
  for (const row of rows) {
    const existing = await findProductByDomain(db, row.url);
    if (existing && !parsed.data.refreshExisting) {
      skipped.push(`${existing.name} (already a product)`);
      continue;
    }
    const category = row.categorySlug ?? parsed.data.categorySlug ?? null;
    const job = await createReviewJob(db, {
      preset: existing ? "refresh" : parsed.data.preset,
      productId: existing?.id ?? null,
      requestedByUserId: user.id,
      costCeilingUsd: parsed.data.costCeilingUsd ?? null,
      batchId,
      input: {
        url: row.url,
        name: row.name,
        categorySlug: category && categories.has(category) ? category : null,
        angle: row.angle,
        keywords: [],
        competitors: [],
        ...(existing ? { productId: existing.id } : {}),
      },
    });
    jobIds.push(job.id);
  }
  await recordAudit(db, {
    actorUserId: user.id,
    action: "job.bulk_create",
    entityType: "job_batch",
    entityId: batchId,
    data: { jobs: jobIds.length, skipped: skipped.length, errors: errors.length },
  });
  for (const id of jobIds) await dispatchJob(id);
  const notes = [
    skipped.length ? `skipped=${encodeURIComponent(skipped.join("; "))}` : "",
    errors.length ? `errors=${encodeURIComponent(errors.map((e) => `line ${e.line}: ${e.message}`).join("; "))}` : "",
  ].filter(Boolean);
  redirect(`/intake/bulk?batch=${batchId}${notes.length ? `&${notes.join("&")}` : ""}`);
}
