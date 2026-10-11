import { evaluateJobAcceptance, evaluateReadiness, listAcceptanceCandidates, type JobAcceptance } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { CheckList, StatusChip, worstStatus } from "../../../components/launch/checks";
import { JobAcceptanceList } from "../../../components/launch/job-acceptance";
import { Empty, PageHeader } from "../../../components/ui";

export const metadata = { title: "Launch readiness" };

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Launch readiness (Phase 4): rollout checklist plus SRS §8 acceptance per review job, computed
 * from stored data. Live behaviour (pages, redirects, Lighthouse) is checked by the launch check.
 */
export default async function LaunchPage() {
  const db = getDb();
  const [readiness, candidates] = await Promise.all([
    evaluateReadiness(db, process.env),
    listAcceptanceCandidates(db, { limit: 20 }),
  ]);
  const results = await Promise.all(candidates.map((c) => evaluateJobAcceptance(db, c.jobId)));
  const rows = candidates.flatMap((candidate, i) => (results[i] ? [{ candidate, result: results[i] }] : []));
  const criteria = rows.flatMap(({ result }: { result: JobAcceptance }) => result.criteria);
  const applicable = criteria.filter((c) => c.status !== "n/a");
  const passing = applicable.filter((c) => c.status === "pass").length;
  const fullyPassing = rows.filter(({ result }) => result.summary.fail === 0 && result.summary.warn === 0).length;
  const ready = readiness.summary;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Launch readiness"
        subtitle={
          <>
            Phase 4 exit: five real products through the full pipeline, every SRS §8 criterion passing here, and the
            scheduled launch check green for 7 days. Then revisit D-3 (human review).
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted">SRS §8 checks passing</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {passing}/{applicable.length}
          </p>
          <p className="text-xs text-muted">across {rows.length} recent review jobs (n/a excluded)</p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted">Jobs with no failures or warnings</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fullyPassing}</p>
          <p className="text-xs text-muted">target: 5 real products</p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted">Rollout checklist</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {ready.pass}/{ready.pass + ready.fail + ready.warn}
          </p>
          <p className="text-xs text-muted">
            {ready.fail} failing · {ready.warn} warnings
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Review jobs (SRS §8)</h2>
        <p className="text-sm text-muted">
          #1 research, evidence and QA within 30 min · #2 published with structured data and go-link CTAs · #3 go-link
          fallback and switch · #4 clicks and Lighthouse · #5 cost · #6 re-run diff without duplicates. #3 and #4 (and
          the live half of #2) are checked by the launch check and the e2e suite. Click a row for details.
        </p>
        {rows.length === 0 ? (
          <Empty>
            No finished review jobs yet. <Link href="/intake">Submit a product</Link> and come back when the job is
            done.
          </Empty>
        ) : (
          <JobAcceptanceList rows={rows} siteUrl={siteUrl} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Rollout checklist</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {readiness.groups.map((g) => (
            <div key={g.id} className="rounded-lg border border-border bg-bg p-4">
              <h3 className="flex items-center justify-between gap-2 font-medium">
                {g.label} <StatusChip status={worstStatus(g.items)} />
              </h3>
              <CheckList items={g.items} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">
          Environment checks cover this CMS deployment only. For web, API and worker run{" "}
          <code>node scripts/prod.mjs env:check</code>.
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-border p-4 text-sm">
        <h2 className="text-lg font-semibold">Live checks</h2>
        <p>
          Stored data cannot prove the live site works. The launch check runs synthetic requests against a deployment:
          health, robots and sitemaps, structured data, disclosure before the first CTA, <code>rel=sponsored</code>, the
          go-link redirect contract, hreflang, security headers and search latency.
        </p>
        <pre className="overflow-auto rounded bg-surface p-3 text-xs">pnpm launch-check --site {siteUrl}</pre>
        <p className="text-muted">
          A scheduled GitHub Actions workflow runs it against production and opens a GitHub issue when a check fails.
          The e2e suite (<code>pnpm e2e</code>) covers the browser flows, accessibility and the Lighthouse budget.
        </p>
      </section>
    </div>
  );
}
