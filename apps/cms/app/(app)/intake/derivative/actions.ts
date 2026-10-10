"use server";

import { createReviewJob, recordAudit } from "@repo/core";
import { getDb } from "@repo/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "../../../../lib/auth";
import { dispatchJob } from "../../../../lib/dispatch";

export type DerivativeState = { ok: boolean; message: string } | null;

const schema = z.object({
  kind: z.enum(["comparison", "alternatives", "best_of"]),
  productIds: z.array(z.uuid()).max(12),
  referenceProductId: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  categorySlug: z.string().trim().optional(),
  angle: z.string().trim().max(300).optional(),
  keywords: z.string().trim().max(500).optional(),
  costCeilingUsd: z.coerce
    .number()
    .positive()
    .max(100)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/** Comparison, alternatives or best-of job from researched products (FR-CON-8, FR-INT-5 presets). */
export async function submitDerivative(_prev: DerivativeState, form: FormData): Promise<DerivativeState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    ...Object.fromEntries([...form.entries()].filter(([k]) => k !== "productIds")),
    productIds: form.getAll("productIds").map(String),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  const input = parsed.data;
  if (input.kind === "comparison" && (input.productIds.length < 2 || input.productIds.length > 3)) {
    return { ok: false, message: "Pick two or three products to compare." };
  }
  if (input.kind === "alternatives" && !input.referenceProductId) {
    return { ok: false, message: "Pick the product the alternatives are for." };
  }
  if (input.kind === "best_of" && !input.categorySlug && input.productIds.length < 3) {
    return { ok: false, message: "Pick a category or at least three products." };
  }
  const db = getDb();
  const job = await createReviewJob(db, {
    preset: input.kind,
    productId: input.referenceProductId ?? null,
    requestedByUserId: user.id,
    costCeilingUsd: input.costCeilingUsd ?? null,
    input: {
      productIds: input.productIds,
      referenceProductId: input.referenceProductId ?? null,
      categorySlug: input.categorySlug || null,
      angle: input.angle || null,
      keywords: (input.keywords ?? "")
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 20),
    },
  });
  await recordAudit(db, {
    actorUserId: user.id,
    action: "job.create",
    entityType: "review_job",
    entityId: job.id,
    data: { preset: input.kind, products: input.productIds.length },
  });
  await dispatchJob(job.id);
  redirect(`/jobs/${job.id}`);
}
