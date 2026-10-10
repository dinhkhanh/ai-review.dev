import { createEvalRun, EVAL_SUITES, finishEvalRun, type EvalCaseResult, type EvalSuite } from "@repo/core";
import { loadGoldenSet } from "./golden";
import {
  applyPromptSource,
  costMeter,
  evalServices,
  openEvalDb,
  openMainDb,
  promptVersions,
  type PromptSource,
} from "./harness";
import { loadSnapshot } from "./snapshot-schema";
import { missingForSuite, SUITE_PROMPTS, SUITES } from "./suites";

/**
 * Prompt eval runner (docs/plan.md §5 "Evals").
 *   pnpm --filter @repo/pipeline eval -- --suite fact_sheet [--cases plausible-analytics] [--compare repo|db|both]
 * `--compare repo` (default) uses the repo prompts; `db` uses the CMS's active overrides and step
 * models; `both` runs each and prints the score delta — the hill-climbing loop for a prompt edit.
 * Options: --no-judge (write), --errors N (fact_check seeded errors), --dry (list cases only).
 */
export interface RunArgs {
  suite: EvalSuite;
  cases: string[] | null;
  compare: PromptSource | "both";
  noJudge: boolean;
  errors: number;
  dry: boolean;
}

export function parseArgs(argv: string[]): RunArgs {
  const args = argv.filter((a) => a !== "--");
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i > -1 ? args[i + 1] : undefined;
  };
  const suite = value("suite");
  if (!suite || !(EVAL_SUITES as readonly string[]).includes(suite)) {
    throw new Error(`--suite must be one of ${EVAL_SUITES.join(", ")}`);
  }
  const compare = value("compare") ?? "repo";
  if (!["repo", "db", "both"].includes(compare)) throw new Error("--compare must be repo, db or both");
  const errors = Number(value("errors") ?? 6);
  return {
    suite: suite as EvalSuite,
    cases:
      value("cases")
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? null,
    compare: compare as RunArgs["compare"],
    noJudge: args.includes("--no-judge"),
    errors: Number.isFinite(errors) && errors > 0 ? Math.floor(errors) : 6,
    dry: args.includes("--dry"),
  };
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);

export function formatTable(results: EvalCaseResult[]): string {
  const rows = results.map((r) => {
    const failed = r.checks.filter((c) => !c.passed).map((c) => (c.detail ? `${c.name} (${c.detail})` : c.name));
    const metrics = Object.entries(r.metrics ?? {})
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    return [r.case, r.status, pct(r.score), metrics, r.note ?? failed.slice(0, 4).join("; ")];
  });
  const head = ["case", "status", "score", "metrics", "failed checks / note"];
  const widths = head.map((h, i) => Math.min(60, Math.max(h.length, ...rows.map((r) => String(r[i]).length))));
  const line = (cells: string[]) => cells.map((c, i) => String(c).slice(0, 60).padEnd(widths[i]!)).join("  ");
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

async function runOnce(args: RunArgs, source: PromptSource) {
  const main = openMainDb();
  const evalDb = await openEvalDb(main.db, main.url);
  const meter = costMeter();
  const services = evalServices(evalDb.db, meter);
  const llm = services.makeLlm(() => {});
  const golden = loadGoldenSet().filter((c) => !args.cases || args.cases.includes(c.slug));
  if (golden.length === 0) throw new Error("No golden cases match --cases");

  await evalDb.reset();
  await applyPromptSource(evalDb.db, main.db, source);
  const versions = await promptVersions(evalDb.db, SUITE_PROMPTS[args.suite], source);
  const run = args.dry ? null : await createEvalRun(main.db, { suite: args.suite, promptVersions: versions });
  console.log(`\n▶ ${args.suite} · prompts: ${JSON.stringify(versions)}`);

  const results: EvalCaseResult[] = [];
  try {
    for (const c of golden) {
      const snap = c.snapshot ? loadSnapshot(c.snapshot) : null;
      const missing = !c.snapshot
        ? "not researched yet (snapshot: null)"
        : !snap
          ? `snapshot ${c.snapshot}.json not exported on this machine`
          : missingForSuite(args.suite, snap);
      if (missing || args.dry) {
        results.push({ case: c.slug, status: "skipped", score: null, checks: [], note: missing ?? "dry run" });
        continue;
      }
      const before = meter.total();
      try {
        await evalDb.reset();
        await applyPromptSource(evalDb.db, main.db, source);
        const res = await SUITES[args.suite](
          { db: evalDb.db, services, llm, noJudge: args.noJudge, seededErrors: args.errors },
          c,
          snap!,
        );
        results.push({ ...res, costUsd: Math.round((meter.total() - before) * 10_000) / 10_000 });
      } catch (error) {
        results.push({
          case: c.slug,
          status: "error",
          score: null,
          checks: [],
          note: String(error).slice(0, 300),
          costUsd: Math.round((meter.total() - before) * 10_000) / 10_000,
        });
      }
      console.log(`  ${c.slug}: ${results.at(-1)!.status} ${pct(results.at(-1)!.score)}`);
    }
    if (run) await finishEvalRun(main.db, run.id, { status: "succeeded", results, costUsd: meter.total() });
  } catch (error) {
    if (run) {
      await finishEvalRun(main.db, run.id, { status: "failed", results, costUsd: meter.total(), error: String(error) });
    }
    throw error;
  } finally {
    await evalDb.close();
    await main.close();
  }
  console.log(`\n${formatTable(results)}\n\ncost $${meter.total().toFixed(4)}${run ? ` · eval run ${run.id}` : ""}`);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources: PromptSource[] = args.compare === "both" ? ["repo", "db"] : [args.compare];
  const runs = new Map<PromptSource, EvalCaseResult[]>();
  for (const source of sources) runs.set(source, await runOnce(args, source));
  if (args.compare === "both") {
    const repo = runs.get("repo")!;
    const db = runs.get("db")!;
    console.log("\nrepo → db score delta");
    for (const r of repo) {
      const d = db.find((x) => x.case === r.case);
      if (r.score === null || d?.score === null || d?.score === undefined) continue;
      const delta = Math.round((d.score - r.score) * 100);
      console.log(`  ${r.case}: ${pct(r.score)} → ${pct(d.score)} (${delta >= 0 ? "+" : ""}${delta} pts)`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
