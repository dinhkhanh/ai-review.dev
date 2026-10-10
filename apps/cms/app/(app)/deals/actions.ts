"use server";

import {
  createDeal,
  deleteDeal,
  DomainError,
  findArticleForProduct,
  getDeal,
  publishEnvFromProcess,
  recordAudit,
  requestRevalidation,
  suggestDealsFromFactSheet,
  updateDeal,
} from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";

export type ActionState = { ok: boolean; message: string } | null;

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const date = (f: FormData, k: string) => {
  const v = str(f, k);
  return v ? new Date(v) : null;
};

/** Deals show on /deals and the product's review page (FR-WEB-8); refresh both. */
async function revalidateDealPages(productId: string) {
  const review = await findArticleForProduct(getDb(), productId, "review");
  await requestRevalidation(publishEnvFromProcess(), {
    paths: ["/deals", ...(review?.publishedVersionId ? [`/reviews/${review.slug}`] : [])],
  });
  revalidatePath("/deals");
}

async function guard(fn: () => Promise<string>): Promise<ActionState> {
  try {
    return { ok: true, message: await fn() };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function saveDealAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(f, "dealId");
  const productId = str(f, "productId");
  return guard(async () => {
    if (!productId) throw new DomainError("invalid", "Pick a product");
    const input = {
      productId,
      title: str(f, "title") ?? "",
      description: str(f, "description"),
      code: str(f, "code"),
      discountText: str(f, "discountText"),
      startsAt: date(f, "startsAt"),
      endsAt: date(f, "endsAt"),
      active: f.get("active") === "on",
      position: Number(str(f, "position") ?? 0) || 0,
    };
    const deal = id ? await updateDeal(getDb(), id, input) : await createDeal(getDb(), { ...input, source: "manual" });
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: id ? "deal.update" : "deal.create",
      entityType: "deal",
      entityId: deal.id,
      data: { title: deal.title, active: deal.active },
    });
    await revalidateDealPages(productId);
    return id ? "Deal saved" : "Deal created";
  });
}

export async function toggleDealAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("dealId"));
  const deal = await getDeal(getDb(), id);
  if (!deal) return;
  await updateDeal(getDb(), id, { active: !deal.active });
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: deal.active ? "deal.deactivate" : "deal.activate",
    entityType: "deal",
    entityId: id,
  });
  await revalidateDealPages(deal.productId);
}

export async function deleteDealAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("dealId"));
  const deal = await getDeal(getDb(), id);
  if (!deal) return;
  await deleteDeal(getDb(), id);
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "deal.delete",
    entityType: "deal",
    entityId: id,
    data: { title: deal.title },
  });
  await revalidateDealPages(deal.productId);
}

export async function suggestDealsAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const productId = str(f, "productId");
  return guard(async () => {
    if (!productId) throw new DomainError("invalid", "Pick a product");
    const created = await suggestDealsFromFactSheet(getDb(), productId);
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: "deal.suggest",
      entityType: "product",
      entityId: productId,
      data: { created: created.length },
    });
    revalidatePath("/deals");
    return created.length
      ? `${created.length} draft deal${created.length === 1 ? "" : "s"} added (inactive until you activate them)`
      : "No new deals found in the fact sheet or program notes";
  });
}
