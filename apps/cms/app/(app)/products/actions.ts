"use server";

import { KNOWN_NETWORKS, type LinkFormat, type Network } from "@repo/affiliate";
import { factSheetSchema } from "@repo/content";
import {
  createLink,
  createProgram,
  createReviewJob,
  deleteLink,
  DomainError,
  getProduct,
  recordAudit,
  saveFactSheet,
  setGoSlugFallback,
  updateLink,
  updateMediaAlt,
  updateProduct,
  updateProgram,
} from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../../../lib/auth";
import { invalidateProductLinks } from "../../../lib/cache";
import { dispatchJob } from "../../../lib/dispatch";

export type ActionState = { ok: boolean; message: string } | null;

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === null ? null : Number(v);
};
const date = (f: FormData, k: string) => {
  const v = str(f, k);
  return v ? new Date(v) : null;
};

async function guard<T>(fn: () => Promise<T>): Promise<ActionState> {
  try {
    await fn();
    return { ok: true, message: "Saved" };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    if (error instanceof Error && error.name === "ZodError") return { ok: false, message: error.message.slice(0, 500) };
    throw error;
  }
}

export async function updateProductAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(f.get("productId"));
  return guard(async () => {
    await updateProduct(getDb(), id, {
      name: str(f, "name") ?? undefined,
      tagline: str(f, "tagline"),
      categoryId: str(f, "categoryId"),
      status: (str(f, "status") as "draft" | "active" | "discontinued" | "archived" | null) ?? undefined,
      refreshIntervalDays: num(f, "refreshIntervalDays") ?? undefined,
    });
    await recordAudit(getDb(), { actorUserId: user.id, action: "product.update", entityType: "product", entityId: id });
    revalidatePath(`/products/${id}`);
  });
}

/** FR-RES-8: manual fact-sheet edits create a new version before writing begins. */
export async function saveFactSheetAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(f.get("productId"));
  let json: unknown;
  try {
    json = JSON.parse(String(f.get("json") ?? ""));
  } catch {
    return { ok: false, message: "Not valid JSON" };
  }
  const parsed = factSheetSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  const saved = await saveFactSheet(getDb(), id, parsed.data, { userId: user.id });
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "fact_sheet.edit",
    entityType: "product",
    entityId: id,
    data: { version: saved.version },
  });
  revalidatePath(`/products/${id}`);
  return { ok: true, message: `Saved as version ${saved.version} (${saved.diffFromPrevious?.length ?? 0} changes)` };
}

export async function refreshProductAction(f: FormData) {
  const user = await requireUser();
  const id = String(f.get("productId"));
  const product = await getProduct(getDb(), id);
  if (!product) return;
  const job = await createReviewJob(getDb(), {
    preset: "refresh",
    productId: id,
    requestedByUserId: user.id,
    input: { productId: id, url: product.websiteUrl },
  });
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "job.refresh",
    entityType: "review_job",
    entityId: job.id,
  });
  await dispatchJob(job.id);
  redirect(`/jobs/${job.id}`);
}

function linkFormatFrom(f: FormData): LinkFormat | null {
  const kind = str(f, "formatKind");
  const subIdParam = str(f, "subIdParam") ?? undefined;
  if (kind === "query_param") {
    const param = str(f, "formatParam");
    const value = str(f, "formatValue");
    if (!param || !value) throw new DomainError("invalid", "Referral links need a parameter name and your referral id");
    return { kind, param, value, ...(subIdParam ? { subIdParam } : {}) };
  }
  if (kind === "network_link") {
    const network = str(f, "network") as Network;
    return { kind, network, ...(subIdParam ? { subIdParam } : {}) };
  }
  if (kind === "static_url") return { kind, ...(subIdParam ? { subIdParam } : {}) };
  return null;
}

export async function saveProgramAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const productId = String(f.get("productId"));
  const programId = str(f, "programId");
  const network = (str(f, "network") ?? "direct") as Network;
  if (!(KNOWN_NETWORKS as readonly string[]).includes(network)) return { ok: false, message: "Unknown network" };
  return guard(async () => {
    const values = {
      network,
      name: str(f, "name") ?? "Affiliate program",
      status: (str(f, "status") ?? "found") as never,
      commissionModel: (str(f, "commissionModel") ?? "unknown") as never,
      commissionValue: num(f, "commissionValue"),
      recurringMonths: num(f, "recurringMonths"),
      cookieDays: num(f, "cookieDays"),
      signupUrl: str(f, "signupUrl"),
      dashboardUrl: str(f, "dashboardUrl"),
      termsUrl: str(f, "termsUrl"),
      redirectPolicy: (str(f, "redirectPolicy") ?? "unknown") as never,
      linkFormat: linkFormatFrom(f),
      notes: str(f, "notes"),
    };
    if (programId) await updateProgram(getDb(), programId, values);
    else await createProgram(getDb(), { productId, ...values });
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: programId ? "program.update" : "program.create",
      entityType: "affiliate_program",
      entityId: programId ?? productId,
      data: { status: values.status, network },
    });
    await invalidateProductLinks(productId);
    revalidatePath(`/products/${productId}`);
    revalidatePath("/affiliate");
  });
}

export async function setProgramStatusAction(f: FormData) {
  const user = await requireUser();
  const programId = String(f.get("programId"));
  const productId = String(f.get("productId"));
  const status = String(f.get("status")) as never;
  await updateProgram(getDb(), programId, { status });
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "program.status",
    entityType: "affiliate_program",
    entityId: programId,
    data: { status },
  });
  await invalidateProductLinks(productId);
  revalidatePath(`/products/${productId}`);
  revalidatePath("/affiliate");
}

export async function saveLinkAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const productId = String(f.get("productId"));
  const linkId = str(f, "linkId");
  return guard(async () => {
    const values = {
      programId: str(f, "programId"),
      label: str(f, "label") ?? "Default",
      destinationUrl: str(f, "destinationUrl") ?? "",
      region:
        (str(f, "region") ?? "global").toUpperCase() === "GLOBAL"
          ? "global"
          : (str(f, "region") ?? "global").toUpperCase(),
      status: (str(f, "status") ?? "active") as never,
      priority: num(f, "priority") ?? 100,
      weight: num(f, "weight") ?? 100,
      startsAt: date(f, "startsAt"),
      endsAt: date(f, "endsAt"),
      notes: str(f, "notes"),
    };
    if (linkId) await updateLink(getDb(), linkId, values);
    else await createLink(getDb(), { productId, ...values });
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: linkId ? "link.update" : "link.create",
      entityType: "affiliate_link",
      entityId: linkId ?? productId,
      data: { status: values.status, priority: values.priority },
    });
    await invalidateProductLinks(productId);
    revalidatePath(`/products/${productId}`);
  });
}

export async function deleteLinkAction(f: FormData) {
  const user = await requireUser();
  const productId = String(f.get("productId"));
  const linkId = String(f.get("linkId"));
  await deleteLink(getDb(), linkId);
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "link.delete",
    entityType: "affiliate_link",
    entityId: linkId,
  });
  await invalidateProductLinks(productId);
  revalidatePath(`/products/${productId}`);
}

export async function saveFallbackAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const productId = String(f.get("productId"));
  return guard(async () => {
    await setGoSlugFallback(getDb(), String(f.get("slug")), String(f.get("fallbackUrl")));
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: "golink.fallback",
      entityType: "product",
      entityId: productId,
    });
    await invalidateProductLinks(productId);
    revalidatePath(`/products/${productId}`);
  });
}

export async function saveAltAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  await requireUser();
  return guard(async () => {
    await updateMediaAlt(getDb(), String(f.get("assetId")), String(f.get("alt") ?? ""));
    revalidatePath(`/products/${String(f.get("productId"))}`);
  });
}
