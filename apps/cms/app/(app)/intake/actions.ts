"use server";

import {
  costSink,
  createReviewJob,
  DomainError,
  findArticleForProduct,
  findProductByDomain,
  normalizeWebsiteUrl,
  assertPublicHttpUrl,
  recordAudit,
} from "@repo/core";
import { createFirecrawl } from "@repo/ai";
import { getDb } from "@repo/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "../../../lib/auth";
import { dispatchJob } from "../../../lib/dispatch";

export interface Candidate {
  name: string;
  url: string;
  description: string | null;
}

export type IntakeState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "candidates"; candidates: Candidate[] }
  | {
      kind: "duplicate";
      product: { id: string; name: string; domain: string };
      article: { id: string; status: string } | null;
    };

const NOT_OFFICIAL =
  /(wikipedia|g2\.com|capterra|trustpilot|producthunt|reddit|youtube|linkedin|twitter|x\.com|facebook|crunchbase|github\.com|medium\.com|apps\.apple|play\.google|alternativeto)/i;

/** FR-INT-3: resolve a name to candidate official sites for a one-click choice. */
export async function findCandidates(name: string): Promise<IntakeState> {
  await requireUser();
  const query = name.trim();
  if (query.length < 2) return { kind: "error", message: "Type a product name first." };
  const firecrawl = createFirecrawl({ onCost: costSink(getDb(), {}) });
  try {
    const hits = await firecrawl.search(`${query} official website`, { limit: 8 });
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const h of hits) {
      if (NOT_OFFICIAL.test(h.url)) continue;
      let origin: string;
      try {
        origin = normalizeWebsiteUrl(h.url);
      } catch {
        continue;
      }
      if (seen.has(origin)) continue;
      seen.add(origin);
      candidates.push({ name: h.title ?? origin, url: origin, description: h.description });
    }
    return candidates.length
      ? { kind: "candidates", candidates: candidates.slice(0, 5) }
      : { kind: "error", message: "No official site found. Paste the URL instead." };
  } catch (error) {
    return { kind: "error", message: `Search failed: ${String(error).slice(0, 200)}` };
  }
}

const intakeSchema = z.object({
  url: z.string().trim().min(1, "Pick a candidate or paste the product URL"),
  name: z.string().trim().max(120).optional(),
  categorySlug: z.string().trim().optional(),
  keywords: z.string().trim().max(500).optional(),
  angle: z.string().trim().max(300).optional(),
  competitors: z.string().trim().max(500).optional(),
  preset: z.enum(["quick_review", "full_review"]).default("quick_review"),
  costCeilingUsd: z.coerce
    .number()
    .positive()
    .max(100)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  confirmRefresh: z.string().optional(),
});

const list = (s?: string) =>
  (s ?? "")
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);

/** FR-INT-1/4/5: create a review job (or a refresh of the existing product) and dispatch it. */
export async function submitIntake(_prev: IntakeState, formData: FormData): Promise<IntakeState> {
  const user = await requireUser();
  const parsed = intakeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { kind: "error", message: parsed.error.issues.map((i) => i.message).join("; ") };
  const input = parsed.data;
  const db = getDb();
  let websiteUrl: string;
  try {
    websiteUrl = normalizeWebsiteUrl(input.url);
    assertPublicHttpUrl(websiteUrl);
  } catch (error) {
    return { kind: "error", message: error instanceof DomainError ? error.message : "Invalid URL" };
  }

  const existing = await findProductByDomain(db, websiteUrl);
  if (existing && !input.confirmRefresh) {
    const article = await findArticleForProduct(db, existing.id);
    return {
      kind: "duplicate",
      product: { id: existing.id, name: existing.name, domain: existing.domain },
      article: article ? { id: article.id, status: article.status } : null,
    };
  }

  const job = await createReviewJob(db, {
    preset: existing ? "refresh" : input.preset,
    productId: existing?.id ?? null,
    requestedByUserId: user.id,
    costCeilingUsd: input.costCeilingUsd ?? null,
    input: {
      url: websiteUrl,
      name: input.name || null,
      categorySlug: input.categorySlug || null,
      keywords: list(input.keywords),
      angle: input.angle || null,
      competitors: list(input.competitors),
      ...(existing ? { productId: existing.id } : {}),
    },
  });
  await recordAudit(db, {
    actorUserId: user.id,
    action: existing ? "job.refresh" : "job.create",
    entityType: "review_job",
    entityId: job.id,
    data: { url: websiteUrl, preset: job.preset },
  });
  await dispatchJob(job.id);
  redirect(`/jobs/${job.id}`);
}
