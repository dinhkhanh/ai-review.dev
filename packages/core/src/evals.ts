import { and, desc, eq, evalRuns, sql, type DbOrTx } from "@repo/db";
import { DomainError } from "./errors";

/** Eval suites run against the golden set (docs/plan.md §5 "Evals"). */
export const EVAL_SUITES = ["fact_sheet", "write", "fact_check"] as const;
export type EvalSuite = (typeof EVAL_SUITES)[number];

/** One golden case's outcome. `checks` holds the graded expectations (name, passed, detail). */
export interface EvalCaseResult {
  case: string;
  status: "passed" | "failed" | "skipped" | "error";
  /** 0–1 share of checks passed (null when skipped or errored). */
  score: number | null;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  metrics?: Record<string, number | string | null>;
  note?: string;
  costUsd?: number;
  [key: string]: unknown;
}

export async function createEvalRun(db: DbOrTx, input: { suite: EvalSuite; promptVersions: Record<string, string> }) {
  const [row] = await db
    .insert(evalRuns)
    .values({ suite: input.suite, promptVersions: input.promptVersions, status: "running" })
    .returning();
  return row!;
}

/** Aggregates case results into the run summary shown in the CMS. */
export function summarizeEvalResults(results: EvalCaseResult[]) {
  const scored = results.filter((r) => r.score !== null);
  const mean = scored.length ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null;
  // Numeric metrics are averaged across cases that report them.
  const metricSums = new Map<string, { sum: number; n: number }>();
  for (const r of results) {
    for (const [k, v] of Object.entries(r.metrics ?? {})) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const m = metricSums.get(k) ?? { sum: 0, n: 0 };
      metricSums.set(k, { sum: m.sum + v, n: m.n + 1 });
    }
  }
  return {
    cases: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    meanScore: mean === null ? null : Math.round(mean * 1000) / 1000,
    metrics: Object.fromEntries(
      [...metricSums].map(([k, { sum, n }]) => [k, Math.round((sum / n) * 1000) / 1000]),
    ) as Record<string, number>,
  };
}

export async function finishEvalRun(
  db: DbOrTx,
  id: string,
  input: { status: "succeeded" | "failed"; results: EvalCaseResult[]; costUsd: number; error?: string | null },
) {
  const summary = { ...summarizeEvalResults(input.results), ...(input.error ? { error: input.error } : {}) };
  const [row] = await db
    .update(evalRuns)
    .set({
      status: input.status,
      results: input.results,
      summary,
      costUsd: input.costUsd.toFixed(6),
      finishedAt: sql`now()`,
    })
    .where(eq(evalRuns.id, id))
    .returning();
  if (!row) throw new DomainError("not_found", `Eval run ${id} not found`);
  return row;
}

export async function listEvalRuns(db: DbOrTx, opts: { suite?: EvalSuite; limit?: number } = {}) {
  return db
    .select()
    .from(evalRuns)
    .where(and(opts.suite ? eq(evalRuns.suite, opts.suite) : undefined))
    .orderBy(desc(evalRuns.startedAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

export async function getEvalRun(db: DbOrTx, id: string) {
  const [row] = await db.select().from(evalRuns).where(eq(evalRuns.id, id)).limit(1);
  return row ?? null;
}
