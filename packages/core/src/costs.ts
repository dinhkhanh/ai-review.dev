import { costLedger, eq, jobSteps, reviewJobs, sql, type DbOrTx } from "@repo/db";

/** Shape emitted by @repo/ai adapters for every paid call (constraint C-4). */
export interface CostEvent {
  provider: string;
  model?: string;
  operation: string;
  units: number;
  unitType: "tokens" | "credits" | "images" | "seconds" | "characters" | "requests";
  costUsd: number;
  meta?: Record<string, unknown>;
}

export interface CostContext {
  jobId?: string | null;
  stepId?: string | null;
}

/** Writes a ledger row and rolls the cost up to the step and job totals in one transaction. */
export async function recordCost(db: DbOrTx, ctx: CostContext, event: CostEvent): Promise<void> {
  const cost = event.costUsd.toFixed(6);
  await db.transaction(async (tx) => {
    await tx.insert(costLedger).values({
      jobId: ctx.jobId ?? null,
      stepId: ctx.stepId ?? null,
      provider: event.provider,
      model: event.model ?? null,
      operation: event.operation,
      units: event.units.toString(),
      unitType: event.unitType,
      costUsd: cost,
      meta: event.meta,
    });
    if (ctx.stepId) {
      await tx
        .update(jobSteps)
        .set({ costUsd: sql`${jobSteps.costUsd} + ${cost}::numeric` })
        .where(eq(jobSteps.id, ctx.stepId));
    }
    if (ctx.jobId) {
      await tx
        .update(reviewJobs)
        .set({ totalCostUsd: sql`${reviewJobs.totalCostUsd} + ${cost}::numeric` })
        .where(eq(reviewJobs.id, ctx.jobId));
    }
  });
}

/** A ledger sink bound to a job/step, handed to AI adapters. */
export function costSink(db: DbOrTx, ctx: CostContext) {
  return (event: CostEvent) => recordCost(db, ctx, event);
}
