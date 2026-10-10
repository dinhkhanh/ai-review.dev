import { and, desc, eq, inArray, jobSteps, products, reviewJobs, sql, type DbOrTx } from "@repo/db";
import { DomainError } from "./errors";
import { getSetting } from "./settings";

type JobPreset = (typeof reviewJobs.preset.enumValues)[number];
type JobStatus = (typeof reviewJobs.status.enumValues)[number];

export interface CreateJobInput {
  preset: JobPreset;
  input: Record<string, unknown>;
  productId?: string | null;
  requestedByUserId?: string | null;
  costCeilingUsd?: number | null;
  batchId?: string | null;
}

export async function createReviewJob(db: DbOrTx, input: CreateJobInput) {
  const [job] = await db
    .insert(reviewJobs)
    .values({
      preset: input.preset,
      input: input.input,
      productId: input.productId ?? null,
      requestedByUserId: input.requestedByUserId ?? null,
      costCeilingUsd: input.costCeilingUsd?.toFixed(6) ?? null,
      batchId: input.batchId ?? null,
    })
    .returning();
  return job!;
}

export async function setJobStatus(
  db: DbOrTx,
  jobId: string,
  status: JobStatus,
  extra: { error?: string | null; runId?: string } = {},
) {
  const now = new Date();
  await db
    .update(reviewJobs)
    .set({
      status,
      ...(extra.runId ? { runId: extra.runId } : {}),
      ...(extra.error !== undefined ? { error: extra.error } : {}),
      ...(status === "running" ? { startedAt: sql`coalesce(${reviewJobs.startedAt}, now())` } : {}),
      ...(["succeeded", "failed", "cancelled"].includes(status) ? { finishedAt: now } : {}),
    })
    .where(eq(reviewJobs.id, jobId));
}

/**
 * Starts (or resumes) a step attempt. The unique (job, name, attempt) key makes this safe to call
 * again after a worker restart: an existing succeeded attempt is returned instead of re-running.
 */
export async function startStep(db: DbOrTx, jobId: string, name: string, input: unknown, attempt = 1) {
  const [existing] = await db
    .select()
    .from(jobSteps)
    .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.name, name), eq(jobSteps.attempt, attempt)))
    .limit(1);
  if (existing?.status === "succeeded") return { step: existing, alreadyDone: true as const };
  if (existing) {
    const [step] = await db
      .update(jobSteps)
      .set({ status: "running", startedAt: new Date(), error: null, input: input ?? null })
      .where(eq(jobSteps.id, existing.id))
      .returning();
    return { step: step!, alreadyDone: false as const };
  }
  const [step] = await db
    .insert(jobSteps)
    .values({ jobId, name, attempt, status: "running", startedAt: new Date(), input: input ?? null })
    .returning();
  return { step: step!, alreadyDone: false as const };
}

export interface StepResult {
  status: "succeeded" | "failed" | "skipped";
  output?: unknown;
  error?: string;
  model?: string;
  effort?: string;
  promptVersion?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export async function finishStep(db: DbOrTx, stepId: string, result: StepResult) {
  const [step] = await db
    .update(jobSteps)
    .set({
      status: result.status,
      output: result.output ?? null,
      error: result.error ?? null,
      model: result.model,
      effort: result.effort,
      promptVersion: result.promptVersion,
      tokensIn: sql`${jobSteps.tokensIn} + ${result.tokensIn ?? 0}`,
      tokensOut: sql`${jobSteps.tokensOut} + ${result.tokensOut ?? 0}`,
      finishedAt: new Date(),
    })
    .where(eq(jobSteps.id, stepId))
    .returning();
  if (!step) throw new DomainError("not_found", `Step ${stepId} not found`);
  return step;
}

export async function getJob(db: DbOrTx, jobId: string) {
  const [job] = await db.select().from(reviewJobs).where(eq(reviewJobs.id, jobId)).limit(1);
  if (!job) return null;
  const steps = await db.select().from(jobSteps).where(eq(jobSteps.jobId, jobId)).orderBy(jobSteps.createdAt);
  return { ...job, steps };
}

export async function listJobs(db: DbOrTx, limit = 50) {
  return db
    .select({
      id: reviewJobs.id,
      preset: reviewJobs.preset,
      status: reviewJobs.status,
      input: reviewJobs.input,
      productId: reviewJobs.productId,
      productName: products.name,
      articleId: reviewJobs.articleId,
      totalCostUsd: reviewJobs.totalCostUsd,
      error: reviewJobs.error,
      createdAt: reviewJobs.createdAt,
      startedAt: reviewJobs.startedAt,
      finishedAt: reviewJobs.finishedAt,
    })
    .from(reviewJobs)
    .leftJoin(products, eq(products.id, reviewJobs.productId))
    .orderBy(desc(reviewJobs.createdAt))
    .limit(Math.min(limit, 200));
}

export async function setJobLinks(db: DbOrTx, jobId: string, links: { productId?: string; articleId?: string }) {
  await db.update(reviewJobs).set(links).where(eq(reviewJobs.id, jobId));
}

type StepRow = typeof jobSteps.$inferSelect;

/** Latest attempt of every step in a job, keyed by step name. */
export async function latestStepRuns(db: DbOrTx, jobId: string): Promise<Map<string, StepRow>> {
  const rows = await db.select().from(jobSteps).where(eq(jobSteps.jobId, jobId)).orderBy(jobSteps.attempt);
  const latest = new Map<string, StepRow>();
  for (const row of rows) latest.set(row.name, row);
  return latest;
}

/**
 * Marks the latest succeeded attempts of these steps as stale (SRS §7: re-running a step makes
 * downstream steps stale); the orchestrator then runs a fresh attempt instead of reusing them.
 */
export async function markStepsStale(db: DbOrTx, jobId: string, names: readonly string[]) {
  if (names.length === 0) return;
  const latest = await latestStepRuns(db, jobId);
  const ids = names
    .map((n) => latest.get(n))
    .filter((r): r is StepRow => !!r && r.status === "succeeded")
    .map((r) => r.id);
  if (ids.length) await db.update(jobSteps).set({ status: "stale" }).where(inArray(jobSteps.id, ids));
}

export async function appendStepLogs(
  db: DbOrTx,
  stepId: string,
  lines: Array<{ ts: string; message: string; data?: Record<string, unknown> }>,
) {
  if (lines.length === 0) return;
  await db
    .update(jobSteps)
    .set({ logs: sql`${jobSteps.logs} || ${JSON.stringify(lines)}::jsonb` })
    .where(eq(jobSteps.id, stepId));
}

/** Requests cancellation; the orchestrator checks between steps. */
export async function cancelJob(db: DbOrTx, jobId: string) {
  await db
    .update(reviewJobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(
      and(eq(reviewJobs.id, jobId), inArray(reviewJobs.status, ["queued", "running", "awaiting_approval", "failed"])),
    );
}

export async function isJobCancelled(db: DbOrTx, jobId: string) {
  const [row] = await db
    .select({ status: reviewJobs.status })
    .from(reviewJobs)
    .where(eq(reviewJobs.id, jobId))
    .limit(1);
  return row?.status === "cancelled";
}

/** Re-queues a finished job so the orchestrator picks it up again (retry / re-run from a step). */
export async function requeueJob(db: DbOrTx, jobId: string) {
  await db
    .update(reviewJobs)
    .set({ status: "queued", error: null, finishedAt: null, runId: null })
    .where(eq(reviewJobs.id, jobId));
}

/**
 * Atomically claims the oldest queued job not handed to Trigger.dev (local runner). `skip locked`
 * lets several runners poll safely.
 */
export async function claimNextQueuedJob(db: DbOrTx) {
  const rows = await db.execute<{ id: string }>(sql`
    update review_jobs set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
    where id = (
      select id from review_jobs where status = 'queued' and run_id is null order by created_at for update skip locked limit 1
    )
    returning id`);
  return rows[0]?.id ?? null;
}

/** Effective cost ceiling for a job (FR-INT-6): its own, else the default from settings. */
export async function jobCostStatus(db: DbOrTx, jobId: string) {
  const [job] = await db
    .select({ total: reviewJobs.totalCostUsd, ceiling: reviewJobs.costCeilingUsd })
    .from(reviewJobs)
    .where(eq(reviewJobs.id, jobId))
    .limit(1);
  if (!job) throw new DomainError("not_found", `Job ${jobId} not found`);
  const ceiling =
    job.ceiling !== null ? Number(job.ceiling) : ((await getSetting(db, "costs.defaultCeilingUsd")) ?? null);
  const total = Number(job.total);
  return { total, ceiling, exceeded: ceiling !== null && total >= ceiling };
}

/**
 * Lets a job paused at its cost ceiling continue (FR-INT-6): raises the ceiling and re-queues it.
 * The new ceiling must be above what the job has already spent.
 */
export async function approveJobOverCeiling(db: DbOrTx, jobId: string, newCeilingUsd: number) {
  const { total } = await jobCostStatus(db, jobId);
  if (!(newCeilingUsd > total)) {
    throw new DomainError("invalid", `The new ceiling must be above the $${total.toFixed(2)} already spent`);
  }
  const [row] = await db
    .update(reviewJobs)
    .set({ costCeilingUsd: newCeilingUsd.toFixed(6), status: "queued", error: null, finishedAt: null, runId: null })
    .where(and(eq(reviewJobs.id, jobId), eq(reviewJobs.status, "awaiting_approval")))
    .returning();
  if (!row) throw new DomainError("invalid", "Only jobs awaiting approval can be approved");
  return row;
}

/** Jobs created by one bulk submission (FR-INT-2). */
export async function listBatchJobs(db: DbOrTx, batchId: string) {
  return db
    .select({
      id: reviewJobs.id,
      status: reviewJobs.status,
      input: reviewJobs.input,
      productName: products.name,
      totalCostUsd: reviewJobs.totalCostUsd,
      error: reviewJobs.error,
    })
    .from(reviewJobs)
    .leftJoin(products, eq(products.id, reviewJobs.productId))
    .where(eq(reviewJobs.batchId, batchId))
    .orderBy(reviewJobs.createdAt);
}

/** Whether a product already has a job waiting or running (refresh scheduler, bulk intake). */
export async function hasActiveJob(db: DbOrTx, productId: string) {
  const [row] = await db
    .select({ id: reviewJobs.id })
    .from(reviewJobs)
    .where(
      and(eq(reviewJobs.productId, productId), inArray(reviewJobs.status, ["queued", "running", "awaiting_approval"])),
    )
    .limit(1);
  return !!row;
}
