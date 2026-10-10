import { EVAL_SUITES, getEvalRun, listEvalRuns, type EvalCaseResult, type EvalSuite } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { Empty, fmtDate, JsonView, PageHeader, StatusBadge, Table, Tabs, usd4 } from "../../../../components/ui";
import { requireUser } from "../../../../lib/auth";

export const metadata = { title: "Prompt evals" };

interface Summary {
  cases?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  errors?: number;
  meanScore?: number | null;
  metrics?: Record<string, number>;
  error?: string;
}

const pct = (n: number | null | undefined) => (typeof n === "number" ? `${Math.round(n * 100)}%` : "—");

function Metrics({ metrics }: { metrics?: Record<string, unknown> }) {
  const entries = Object.entries(metrics ?? {}).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="text-xs tabular-nums">
      {entries.map(([k, v]) => (
        <span key={k} className="mr-2 inline-block">
          <span className="text-muted">{k}</span> {String(v)}
        </span>
      ))}
    </span>
  );
}

/** Prompt eval runs on the golden set (docs/plan.md §5 "Evals"); runs come from the eval CLI. */
export default async function EvalsPage({ searchParams }: { searchParams: Promise<{ suite?: string; run?: string }> }) {
  await requireUser();
  const { suite: suiteParam, run: runId } = await searchParams;
  const suite = (EVAL_SUITES as readonly string[]).includes(suiteParam ?? "") ? (suiteParam as EvalSuite) : undefined;
  const db = getDb();
  const [runs, selected] = await Promise.all([
    listEvalRuns(db, { suite, limit: 100 }),
    runId ? getEvalRun(db, runId) : Promise.resolve(null),
  ]);
  const results = (selected?.results ?? []) as EvalCaseResult[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prompt evals"
        subtitle={
          <>
            Golden-set evals for the fact-sheet, writing and fact-check prompts. Run them from a machine with research
            snapshots: <code>pnpm --filter @repo/pipeline eval -- --suite fact_sheet --compare both</code> compares the
            repo prompt with the active override. <Link href="/settings?tab=prompts">Prompts</Link>
          </>
        }
      />
      <Tabs
        active={suite ?? "all"}
        tabs={[
          { key: "all", label: "All", href: "/settings/evals" },
          ...EVAL_SUITES.map((s) => ({ key: s, label: s.replace("_", " "), href: `/settings/evals?suite=${s}` })),
        ]}
      />
      {runs.length === 0 ? (
        <Empty>No eval runs yet.</Empty>
      ) : (
        <Table head={["Started", "Suite", "Status", "Prompts", "Cases", "Mean score", "Metrics", "Cost", ""]}>
          {runs.map((r) => {
            const s = (r.summary ?? {}) as Summary;
            const prompts = Object.entries(r.promptVersions).filter(([k]) => k !== "source");
            return (
              <tr key={r.id} className={`border-t border-border align-top ${r.id === runId ? "bg-surface" : ""}`}>
                <td className="p-3 tabular-nums">{fmtDate(r.startedAt)}</td>
                <td className="p-3">{r.suite.replace("_", " ")}</td>
                <td className="p-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="p-3 text-xs">
                  <span className="text-muted">{r.promptVersions.source ?? "repo"}</span>
                  {prompts.map(([k, v]) => (
                    <div key={k}>{v}</div>
                  ))}
                </td>
                <td className="p-3 text-xs tabular-nums">
                  {s.passed ?? 0} passed · {s.failed ?? 0} failed · {s.skipped ?? 0} skipped
                  {s.errors ? ` · ${s.errors} errors` : ""}
                </td>
                <td className="p-3 tabular-nums">{pct(s.meanScore)}</td>
                <td className="p-3">
                  <Metrics metrics={s.metrics} />
                </td>
                <td className="p-3 tabular-nums">{usd4.format(Number(r.costUsd))}</td>
                <td className="p-3 text-right">
                  <Link
                    href={`/settings/evals?${suite ? `suite=${suite}&` : ""}run=${r.id}`}
                    className="text-brand hover:underline"
                  >
                    Details
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {selected ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Run {fmtDate(selected.startedAt)} · {selected.suite.replace("_", " ")}
          </h2>
          {(selected.summary as Summary | null)?.error ? (
            <p className="text-sm text-danger">{(selected.summary as Summary).error}</p>
          ) : null}
          <Table head={["Case", "Status", "Score", "Metrics", "Failed checks / note", "Cost"]}>
            {results.map((c) => {
              const failed = c.checks.filter((x) => !x.passed);
              return (
                <tr key={c.case} className="border-t border-border align-top">
                  <td className="p-3 font-medium">{c.case}</td>
                  <td className="p-3">
                    <StatusBadge
                      status={c.status === "passed" ? "succeeded" : c.status === "error" ? "failed" : c.status}
                    />
                  </td>
                  <td className="p-3 tabular-nums">{pct(c.score)}</td>
                  <td className="p-3">
                    <Metrics metrics={c.metrics} />
                  </td>
                  <td className="max-w-md p-3 text-xs">
                    {c.note ? <p className="text-muted">{c.note}</p> : null}
                    <ul className="space-y-0.5">
                      {failed.map((x) => (
                        <li key={x.name}>
                          <span className="text-danger">✗</span> {x.name}
                          {x.detail ? <span className="text-muted"> — {x.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                    {c.checks.length ? (
                      <JsonView
                        value={{ checks: c.checks, ...(c.judge ? { judge: c.judge } : {}) }}
                        label="All checks"
                      />
                    ) : null}
                  </td>
                  <td className="p-3 tabular-nums">{typeof c.costUsd === "number" ? usd4.format(c.costUsd) : "—"}</td>
                </tr>
              );
            })}
          </Table>
        </section>
      ) : null}
    </div>
  );
}
