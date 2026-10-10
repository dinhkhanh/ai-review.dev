import { getExperimentReport, listExperiments } from "@repo/core";
import type { affiliateLinks } from "@repo/db";
import { getDb } from "@repo/db";
import { Input, Label } from "@repo/ui/input";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { fmtDate, StatusBadge } from "../../../../components/ui";
import { ExperimentReportTable } from "../../affiliate/experiment-report";
import { completeExperimentAction, startExperimentAction, stopExperimentAction } from "./experiment-actions";

type Link = typeof affiliateLinks.$inferSelect;

const select = "h-9 rounded-md border border-border bg-bg px-2 text-sm";

/** A/B offers on the product page (FR-AFF-13): running and past tests, reports, start form. */
export async function ExperimentsSection({ productId, links }: { productId: string; links: Link[] }) {
  const db = getDb();
  const experiments = await listExperiments(db, { productId });
  const reports = await Promise.all(experiments.map(({ experiment }) => getExperimentReport(db, experiment.id)));
  const running = new Set(experiments.filter((e) => e.experiment.status === "running").map((e) => e.experiment.id));
  const candidates = links.filter((l) => l.status === "active" && !(l.experimentId && running.has(l.experimentId)));
  return (
    <section id="experiments" className="space-y-3">
      <h2 className="font-semibold">A/B offers</h2>
      <p className="text-sm text-muted">
        Test two or more active links (same region) against each other: they share a priority, the go-link splits clicks
        by weight, and each variant&apos;s SubID carries a short link token so imported conversions attribute to it.
        Completing a test keeps the winner and pauses the other variants.
      </p>
      {reports.map((report) => {
        const exp = report.experiment;
        const defaultWinner = report.verdict.winnerLinkId ?? report.verdict.leaderLinkId ?? report.variants[0]?.linkId;
        return (
          <div key={exp.id} className="space-y-3 rounded-lg border border-border bg-bg p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{exp.name}</span>
              <StatusBadge status={exp.status} />
              <span className="text-muted">
                started {fmtDate(exp.startedAt)}
                {exp.endedAt ? ` · ended ${fmtDate(exp.endedAt)}` : ""} · {report.totalClicks} human clicks
              </span>
            </div>
            {exp.notes ? <p className="text-sm text-muted">{exp.notes}</p> : null}
            <ExperimentReportTable report={report} />
            {exp.status !== "completed" ? (
              <div className="flex flex-wrap items-start gap-6">
                <ActionForm action={completeExperimentAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="experimentId" value={exp.id} />
                  <div>
                    <Label>Winner</Label>
                    <select name="winnerLinkId" defaultValue={defaultWinner} className={select}>
                      {report.variants.map((v) => (
                        <option key={v.linkId} value={v.linkId}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {report.verdict.state !== "winner" ? (
                    <label className="flex h-9 items-center gap-2 text-sm">
                      <input type="checkbox" name="allowInconclusive" /> promote without a significant result
                    </label>
                  ) : null}
                  <SubmitButton size="sm" pendingLabel="Promoting…">
                    Promote winner
                  </SubmitButton>
                </ActionForm>
                {exp.status === "running" ? (
                  <ActionForm action={stopExperimentAction} className="flex items-end">
                    <input type="hidden" name="experimentId" value={exp.id} />
                    <SubmitButton size="sm" variant="secondary" pendingLabel="Stopping…" className="mt-5">
                      Stop test
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {candidates.length >= 2 ? (
        <details className="rounded-lg border border-dashed border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">Start an A/B test</summary>
          <ActionForm action={startExperimentAction} className="mt-4 space-y-3">
            <input type="hidden" name="productId" value={productId} />
            <div className="max-w-md">
              <Label>Name</Label>
              <Input name="name" required placeholder="Trial page vs pricing page" />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Variants (tick at least two) and traffic weights</legend>
              {candidates.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" name="linkId" value={l.id} />
                    <span className="font-medium">{l.label}</span>
                    <span className="truncate font-mono text-xs text-muted">{l.destinationUrl}</span>
                    <span className="text-xs text-muted">
                      {l.region} · priority {l.priority}
                    </span>
                  </label>
                  <Input
                    name={`weight:${l.id}`}
                    type="number"
                    min={1}
                    max={10000}
                    defaultValue={100}
                    aria-label={`Weight for ${l.label}`}
                    className="h-8 w-24"
                  />
                </div>
              ))}
            </fieldset>
            <div className="max-w-md">
              <Label>Notes (hypothesis)</Label>
              <Input name="notes" placeholder="The trial page converts better on mobile" />
            </div>
            <SubmitButton size="sm" pendingLabel="Starting…">
              Start test
            </SubmitButton>
          </ActionForm>
        </details>
      ) : (
        <p className="text-sm text-muted">Add at least two active links to run an A/B test.</p>
      )}
    </section>
  );
}
