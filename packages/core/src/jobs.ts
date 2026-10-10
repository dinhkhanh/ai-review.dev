import { and, desc, eq, jobSteps, reviewJobs, sql, type DbOrTx } from "@repo/db";
import { DomainError } from "./errors";

type JobPreset = (typeof reviewJobs.preset.enumValues)[number];
type JobStatus = (typeof reviewJobs.status.enumValues)[number];

export interface CreateJobInput {
  preset: JobPreset;
  input: Record<string, unknown>;
  productId?: string | null;
  requestedByUserId?: string | null;
  costCeilingUsd?: number | null;
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
  return db.select().from(reviewJobs).orderBy(desc(reviewJobs.createdAt)).limit(Math.min(limit, 200));
}
