import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createEvalRun,
  finishEvalRun,
  getEvalRun,
  listEvalRuns,
  summarizeEvalResults,
  type EvalCaseResult,
} from "./evals";

const results: EvalCaseResult[] = [
  { case: "a", status: "passed", score: 1, checks: [{ name: "x", passed: true }], metrics: { recall: 1, words: 1500 } },
  { case: "b", status: "failed", score: 0.5, checks: [], metrics: { recall: 0.5, model: "haiku" } },
  { case: "c", status: "skipped", score: null, checks: [], note: "no snapshot" },
];

describe("summarizeEvalResults", () => {
  it("counts statuses, averages scores and numeric metrics", () => {
    expect(summarizeEvalResults(results)).toEqual({
      cases: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
      errors: 0,
      meanScore: 0.75,
      metrics: { recall: 0.75, words: 1500 },
    });
  });

  it("has no mean score when nothing was scored", () => {
    expect(summarizeEvalResults([results[2]!]).meanScore).toBeNull();
  });
});

describe("eval runs", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => ctx.reset());

  it("creates, finishes and lists runs", async () => {
    const run = await createEvalRun(ctx.db, { suite: "fact_sheet", promptVersions: { fact_sheet: "fact_sheet@v1" } });
    expect(run.status).toBe("running");
    const done = await finishEvalRun(ctx.db, run.id, { status: "succeeded", results, costUsd: 0.1234567 });
    expect(done.costUsd).toBe("0.123457");
    expect(done.summary).toMatchObject({ cases: 3, meanScore: 0.75 });
    expect(done.finishedAt).not.toBeNull();
    await createEvalRun(ctx.db, { suite: "write", promptVersions: {} });
    expect(await listEvalRuns(ctx.db)).toHaveLength(2);
    expect(await listEvalRuns(ctx.db, { suite: "write" })).toHaveLength(1);
    expect((await getEvalRun(ctx.db, run.id))?.results).toHaveLength(3);
  });
});
