import { and, desc, eq, handsOnSessions, inArray, mediaAssets, products, vaultSecrets, type DbOrTx } from "@repo/db";
import { z } from "zod";
import { recordAudit } from "./audit";
import { DomainError } from "./errors";
import { getSetting, type SettingValue } from "./settings";
import { upsertSource } from "./sources";
import { TEST_IDENTITY_SECRET, vaultEnabled } from "./vault";

/**
 * Hands-on trials (FR-RES-7): a browser agent signs up for a free trial with the test identity and
 * records what it saw. Two switches must both be on: the global `pipeline.handsOnTrials` setting
 * and the product's own `hands_on_opt_in`. The session notes become a first-party research source,
 * so the normal chunk → extract → fact sheet → write path cites them like any official page.
 */

export const HANDS_ON_DEFAULT_POLICY: SettingValue<"handsOn.policy"> = { maxSteps: 40, maxCostUsd: 2, maxMinutes: 15 };

/** Why the agent stopped early; anything else in `stopReason` is a free-text error summary. */
export const HANDS_ON_STOP_REASONS = {
  payment_required: "A payment form or checkout appeared",
  captcha: "A CAPTCHA challenge appeared",
  phone_verification: "Phone or SMS verification was required",
  oauth_only: "Sign-up needs a third-party account (Google, Microsoft, GitHub…)",
  paid_plan_only: "No free plan or free trial is offered",
  sign_up_unavailable: "Sign-up is closed, waitlisted or invite-only",
  off_domain: "The flow left the product's domain",
  email_not_received: "The verification email did not arrive",
  step_limit: "Step limit reached",
  cost_limit: "Cost limit reached",
  time_limit: "Time limit reached",
  other: "Stopped by the agent",
} as const;
export type HandsOnStopReason = keyof typeof HANDS_ON_STOP_REASONS;

/** Structured findings from one session (model output, validated). Kept flat for structured outputs. */
export const handsOnFindingsSchema = z.object({
  signedUp: z.boolean().describe("True when the agent got past sign-up into the product itself"),
  planObserved: z.string().describe("Plan or trial the account landed on, as the app shows it; empty if unknown"),
  onboardingSteps: z.array(z.string()).describe("What a new user goes through, in order, one short line each"),
  timeToValueMinutes: z
    .number()
    .nullable()
    .describe("Minutes from landing on the sign-up page to doing something useful in the app; null if never reached"),
  observedFeatures: z.array(z.string()).describe("Features actually seen working in the app"),
  limits: z.array(z.string()).describe("Limits, paywalls, upsells or missing pieces actually seen"),
  uiNotes: z.array(z.string()).describe("Usability observations: clarity, speed, friction"),
  summary: z.string().describe("Three to five plain sentences of what the trial showed"),
});
export type HandsOnFindings = z.infer<typeof handsOnFindingsSchema>;

export interface HandsOnAction {
  ts: string;
  step: number;
  action: string;
  target?: string;
  url?: string;
  /** Typed value as a template (e.g. "{{identity.email}}"); resolved secrets are never stored. */
  value?: string;
  result?: string;
  note?: string;
}

export async function getHandsOnPolicy(db: DbOrTx): Promise<SettingValue<"handsOn.policy">> {
  return { ...HANDS_ON_DEFAULT_POLICY, ...((await getSetting(db, "handsOn.policy")) ?? {}) };
}

export interface HandsOnEligibility {
  eligible: boolean;
  /** Blocking reasons, shown in the CMS. */
  reasons: string[];
  /** Non-blocking caveats (e.g. no inbox: email verification will stop the session). */
  warnings: string[];
}

/** Both switches, a usable vault with the test identity, and an active product. */
export async function handsOnEligibility(
  db: DbOrTx,
  productId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HandsOnEligibility> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const [globalOn, product, identity] = await Promise.all([
    getSetting(db, "pipeline.handsOnTrials"),
    db.select().from(products).where(eq(products.id, productId)).limit(1),
    db.select({ id: vaultSecrets.id }).from(vaultSecrets).where(eq(vaultSecrets.name, TEST_IDENTITY_SECRET)).limit(1),
  ]);
  const p = product[0];
  if (!p) return { eligible: false, reasons: ["Product not found"], warnings };
  if (!globalOn) reasons.push("Hands-on trials are off in Settings (pipeline.handsOnTrials)");
  if (!p.handsOnOptIn) reasons.push("This product is not opted in to hands-on trials");
  if (p.status === "discontinued" || p.status === "archived" || p.discontinuedAt)
    reasons.push(`Product is ${p.status}`);
  if (!vaultEnabled(env)) reasons.push("The vault is disabled (VAULT_KEY is not set)");
  else if (identity.length === 0) reasons.push("No test identity in the vault");
  if (!env.HANDS_ON_INBOX_DOMAIN?.trim()) {
    warnings.push("HANDS_ON_INBOX_DOMAIN is not set: sign-ups that need email verification will stop there");
  }
  if (!env.RESEND_API_KEY?.trim() && env.HANDS_ON_INBOX_DOMAIN?.trim()) {
    warnings.push("RESEND_API_KEY is not set: verification emails cannot be read");
  }
  return { eligible: reasons.length === 0, reasons, warnings };
}

export async function setHandsOnOptIn(db: DbOrTx, productId: string, optIn: boolean, actorUserId?: string | null) {
  const [row] = await db
    .update(products)
    .set({ handsOnOptIn: optIn })
    .where(eq(products.id, productId))
    .returning({ id: products.id, name: products.name });
  if (!row) throw new DomainError("not_found", "Product not found");
  await recordAudit(db, {
    actorUserId: actorUserId ?? null,
    action: optIn ? "hands_on.opt_in" : "hands_on.opt_out",
    entityType: "product",
    entityId: productId,
    data: { name: row.name },
  });
  return row;
}

export async function createHandsOnSession(db: DbOrTx, input: { productId: string; jobId?: string | null }) {
  const [row] = await db
    .insert(handsOnSessions)
    .values({ productId: input.productId, jobId: input.jobId ?? null, status: "queued" })
    .returning();
  return row!;
}

export async function startHandsOnSession(db: DbOrTx, id: string) {
  await db.update(handsOnSessions).set({ status: "running", startedAt: new Date() }).where(eq(handsOnSessions.id, id));
}

/** Live progress for the CMS while the session runs. */
export async function recordHandsOnProgress(
  db: DbOrTx,
  id: string,
  progress: { actions: HandsOnAction[]; screenshotAssetIds?: string[]; costUsd?: number },
) {
  await db
    .update(handsOnSessions)
    .set({
      actions: progress.actions as unknown as Array<Record<string, unknown>>,
      ...(progress.screenshotAssetIds ? { screenshotAssetIds: progress.screenshotAssetIds } : {}),
      ...(progress.costUsd !== undefined ? { costUsd: progress.costUsd.toFixed(6) } : {}),
    })
    .where(eq(handsOnSessions.id, id));
}

export interface FinishHandsOnInput {
  status: "succeeded" | "blocked" | "failed";
  stopReason?: string | null;
  actions: HandsOnAction[];
  findings?: HandsOnFindings | null;
  screenshotAssetIds: string[];
  costUsd: number;
}

export async function finishHandsOnSession(db: DbOrTx, id: string, input: FinishHandsOnInput) {
  const [row] = await db
    .update(handsOnSessions)
    .set({
      status: input.status,
      stopReason: input.stopReason ?? null,
      actions: input.actions as unknown as Array<Record<string, unknown>>,
      findings: (input.findings ?? null) as Record<string, unknown> | null,
      screenshotAssetIds: input.screenshotAssetIds,
      costUsd: input.costUsd.toFixed(6),
      finishedAt: new Date(),
    })
    .where(eq(handsOnSessions.id, id))
    .returning();
  if (!row) throw new DomainError("not_found", "Hands-on session not found");
  return row;
}

export async function getHandsOnSession(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ session: handsOnSessions, productName: products.name, productSlug: products.slug })
    .from(handsOnSessions)
    .innerJoin(products, eq(products.id, handsOnSessions.productId))
    .where(eq(handsOnSessions.id, id))
    .limit(1);
  if (!row) return null;
  const screenshots = row.session.screenshotAssetIds.length
    ? await db.select().from(mediaAssets).where(inArray(mediaAssets.id, row.session.screenshotAssetIds))
    : [];
  const order = new Map(row.session.screenshotAssetIds.map((assetId, i) => [assetId, i]));
  screenshots.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { ...row.session, productName: row.productName, productSlug: row.productSlug, screenshots };
}

export async function listHandsOnSessions(db: DbOrTx, opts: { productId?: string; limit?: number } = {}) {
  return db
    .select({
      id: handsOnSessions.id,
      productId: handsOnSessions.productId,
      productName: products.name,
      jobId: handsOnSessions.jobId,
      status: handsOnSessions.status,
      stopReason: handsOnSessions.stopReason,
      costUsd: handsOnSessions.costUsd,
      screenshots: handsOnSessions.screenshotAssetIds,
      startedAt: handsOnSessions.startedAt,
      finishedAt: handsOnSessions.finishedAt,
      createdAt: handsOnSessions.createdAt,
    })
    .from(handsOnSessions)
    .innerJoin(products, eq(products.id, handsOnSessions.productId))
    .where(opts.productId ? eq(handsOnSessions.productId, opts.productId) : undefined)
    .orderBy(desc(handsOnSessions.createdAt))
    .limit(opts.limit ?? 50);
}

/** Products for the CMS opt-in list: active ones first, opted-in first. */
export async function listHandsOnProducts(db: DbOrTx) {
  return db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      websiteUrl: products.websiteUrl,
      status: products.status,
      handsOnOptIn: products.handsOnOptIn,
    })
    .from(products)
    .where(inArray(products.status, ["draft", "active"]))
    .orderBy(desc(products.handsOnOptIn), products.name);
}

/** True when a session is queued or running for the product (one at a time per product). */
export async function hasActiveHandsOnSession(db: DbOrTx, productId: string) {
  const [row] = await db
    .select({ id: handsOnSessions.id })
    .from(handsOnSessions)
    .where(and(eq(handsOnSessions.productId, productId), inArray(handsOnSessions.status, ["queued", "running"])))
    .limit(1);
  return !!row;
}

/** Stable per-product URL for the hands-on source, so each new session replaces the last one. */
export function handsOnSourceUrl(websiteUrl: string): string {
  const url = new URL(websiteUrl);
  url.hash = "ai-review-hands-on";
  return url.toString();
}

/** Renders findings as the markdown a research source holds (chunked and extracted like a page). */
export function handsOnFindingsMarkdown(
  product: { name: string },
  findings: HandsOnFindings,
  meta: { date: Date; status: string; stopReason?: string | null; screenshotCaptions?: string[] },
): string {
  const day = meta.date.toISOString().slice(0, 10);
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none recorded)");
  const stopped =
    meta.status === "succeeded"
      ? ""
      : `\nThe session stopped early: ${
          HANDS_ON_STOP_REASONS[meta.stopReason as HandsOnStopReason] ?? meta.stopReason ?? "unknown reason"
        }.\n`;
  return [
    `# Hands-on trial of ${product.name} by ai-review.dev (${day})`,
    "",
    `Our test account signed up for ${product.name} on ${day} and used the product directly. These notes record what we saw in the app.${stopped}`,
    "",
    `Signed up: ${findings.signedUp ? "yes" : "no"}.${findings.planObserved ? ` Plan shown in the app: ${findings.planObserved}.` : ""}`,
    findings.timeToValueMinutes !== null
      ? `Time to first useful result: about ${findings.timeToValueMinutes} minutes.`
      : "",
    "",
    "## Summary",
    findings.summary,
    "",
    "## Onboarding",
    list(findings.onboardingSteps),
    "",
    "## Features seen working",
    list(findings.observedFeatures),
    "",
    "## Limits and upsells seen",
    list(findings.limits),
    "",
    "## Usability notes",
    list(findings.uiNotes),
    ...(meta.screenshotCaptions?.length ? ["", "## Screenshots", list(meta.screenshotCaptions)] : []),
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

/**
 * Stores the findings as a first-party source (kind "official": what the vendor's own product
 * shows), replacing the previous session's notes. Returns the source row.
 */
export async function recordHandsOnEvidence(
  db: DbOrTx,
  input: {
    productId: string;
    sessionId: string;
    jobId?: string | null;
    findings: HandsOnFindings;
    status: string;
    stopReason?: string | null;
    screenshotAssetIds?: string[];
    screenshotCaptions?: string[];
    date?: Date;
  },
) {
  const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new DomainError("not_found", "Product not found");
  const date = input.date ?? new Date();
  return upsertSource(db, {
    productId: product.id,
    url: handsOnSourceUrl(product.websiteUrl),
    kind: "official",
    title: `Hands-on trial notes (ai-review.dev, ${date.toISOString().slice(0, 10)})`,
    httpStatus: 200,
    robotsAllowed: true,
    contentMd: handsOnFindingsMarkdown(product, input.findings, {
      date,
      status: input.status,
      stopReason: input.stopReason,
      screenshotCaptions: input.screenshotCaptions,
    }),
    screenshotAssetId: input.screenshotAssetIds?.[0] ?? null,
    jobId: input.jobId ?? null,
  });
}
