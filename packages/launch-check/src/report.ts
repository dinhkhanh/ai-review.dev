import type { CheckResult, Options, Status } from "./types.ts";

const ICON: Record<Status, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "skip" };
const ORDER: Record<Status, number> = { fail: 0, warn: 1, pass: 2, skip: 3 };

export function summarize(results: CheckResult[]): Record<Status, number> {
  const counts: Record<Status, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of results) counts[r.status]++;
  return counts;
}

const shortTarget = (t?: string) => (t ? t.replace(/^https?:\/\//, "").slice(0, 60) : "");

/** Plain-text table, failures first. */
export function formatTable(results: CheckResult[]): string {
  const rows = [...results].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id));
  const idW = Math.min(34, Math.max(5, ...rows.map((r) => r.id.length)));
  const tW = Math.min(60, Math.max(6, ...rows.map((r) => shortTarget(r.target).length)));
  const lines = rows.map(
    (r) =>
      `${ICON[r.status]}  ${r.id.padEnd(idW).slice(0, idW)}  ${shortTarget(r.target).padEnd(tW)}  ${r.message}${r.ref ? `  [${r.ref}]` : ""}`,
  );
  const c = summarize(results);
  return [...lines, "", `${c.pass} passed, ${c.warn} warnings, ${c.fail} failed, ${c.skip} skipped`].join("\n");
}

/** Markdown for the monitor issue: failures and warnings only. */
export function formatMarkdown(results: CheckResult[], opts: Options): string {
  const c = summarize(results);
  const rows = results
    .filter((r) => r.status === "fail" || r.status === "warn")
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id))
    .map(
      (r) => `| ${r.status} | \`${r.id}\` | ${r.target ?? ""} | ${r.message.replaceAll("|", "\\|")} | ${r.ref ?? ""} |`,
    );
  return [
    `**Launch check (${opts.mode})** against ${opts.site}: ${c.fail} failed, ${c.warn} warnings, ${c.pass} passed.`,
    "",
    ...(rows.length
      ? ["| Status | Check | Target | Detail | Ref |", "| --- | --- | --- | --- | --- |", ...rows]
      : ["All checks passed."]),
  ].join("\n");
}
