import { getJob } from "@repo/core";
import { getDb } from "@repo/db";
import { stepsForPreset } from "@repo/pipeline/editor";
import { Button } from "@repo/ui/button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "../../../../components/auto-refresh";
import { SubmitButton } from "../../../../components/submit-button";
import { duration, fmtDate, JsonView, Notice, PageHeader, StatusBadge, usd, usd4 } from "../../../../components/ui";
import { Input } from "@repo/ui/input";
import { ActionForm } from "../../../../components/action-form";
import { approveCeilingAction, cancelJobAction, rerunJob, retryJob } from "../actions";

export const metadata = { title: "Job" };

const REFRESH_ONLY = new Set<string>(["site_check", "refresh_plan", "refresh_rewrite"]);
const WRITE_ONLY = new Set<string>(["competitors", "seo_brief", "write", "style_pass"]);

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(getDb(), id);
  if (!job) notFound();
  const latest = new Map<string, (typeof job.steps)[number]>();
  for (const s of [...job.steps].sort((a, b) => a.attempt - b.attempt)) latest.set(s.name, s);
  const running = job.status === "running" || job.status === "queued";
  const input = job.input as Record<string, unknown>;
  const ceiling = job.costCeilingUsd ? Number(job.costCeilingUsd) : null;
  const total = Number(job.totalCostUsd);
  // Refresh-only steps appear when they ran; a refresh of a live article skips the writing steps.
  const refreshPath = latest.has("refresh_plan");
  const steps = stepsForPreset(job.preset).filter((name) =>
    latest.has(name) ? true : REFRESH_ONLY.has(name) ? false : !(refreshPath && WRITE_ONLY.has(name)),
  );

  return (
    <div className="space-y-6">
      <AutoRefresh active={running} />
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Job <StatusBadge status={job.status} />
          </span>
        }
        subtitle={
          <span>
            {String(input.url ?? input.name ?? "")} · {job.preset.replace("_", " ")} · started {fmtDate(job.startedAt)}{" "}
            · {duration(job.startedAt, job.finishedAt)} · <strong>{usd.format(Number(job.totalCostUsd))}</strong>
            {ceiling ? ` of ${usd.format(ceiling)} ceiling` : ""}
            {job.runId ? ` · Trigger.dev run ${job.runId}` : ""}
          </span>
        }
        actions={
          <>
            {job.productId ? (
              <Link href={`/products/${job.productId}`} className="text-sm text-brand hover:underline">
                Product
              </Link>
            ) : null}
            {job.articleId ? (
              <Link href={`/articles/${job.articleId}`} className="text-sm text-brand hover:underline">
                Article
              </Link>
            ) : null}
            {job.status === "failed" || job.status === "cancelled" ? (
              <form action={retryJob}>
                <input type="hidden" name="jobId" value={job.id} />
                <SubmitButton size="sm">Retry</SubmitButton>
              </form>
            ) : null}
            {running || job.status === "awaiting_approval" ? (
              <form action={cancelJobAction}>
                <input type="hidden" name="jobId" value={job.id} />
                <Button type="submit" size="sm" variant="danger">
                  Cancel
                </Button>
              </form>
            ) : null}
          </>
        }
      />
      {job.error ? <Notice tone="error">{job.error}</Notice> : null}
      {job.status === "queued" && !job.runId ? (
        <Notice>
          Queued for the local runner. Start it with <code>pnpm --filter worker runner</code> (or set Trigger.dev keys
          to run in the cloud).
        </Notice>
      ) : null}
      {job.status === "awaiting_approval" ? (
        <div className="rounded-lg border border-border bg-bg p-4">
          <p className="text-sm">
            Paused at its cost ceiling after spending <strong>{usd.format(total)}</strong>. Approve a higher ceiling to
            continue from the next step, or cancel the job.
          </p>
          <ActionForm action={approveCeilingAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="jobId" value={job.id} />
            <label className="text-sm">
              New ceiling (USD)
              <Input
                name="ceiling"
                type="number"
                step="0.5"
                min={Math.ceil(total + 1)}
                defaultValue={Math.ceil(Math.max(total * 2, (ceiling ?? 0) + 5))}
                className="mt-1 w-32"
              />
            </label>
            <SubmitButton size="sm">Approve and continue</SubmitButton>
          </ActionForm>
        </div>
      ) : null}

      <ol className="space-y-2">
        {steps.map((name) => {
          const step = latest.get(name);
          const attempts = job.steps.filter((s) => s.name === name).length;
          return (
            <li key={name} className="rounded-lg border border-border bg-bg p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm font-medium">{name}</span>
                <StatusBadge status={step?.status ?? "pending"} />
                {step ? (
                  <span className="text-xs text-muted">
                    attempt {step.attempt}
                    {attempts > 1 ? ` of ${attempts}` : ""} · {duration(step.startedAt, step.finishedAt)} ·{" "}
                    {usd4.format(Number(step.costUsd))}
                    {step.model ? ` · ${step.model}` : ""}
                    {step.effort ? ` (${step.effort})` : ""}
                    {step.tokensIn || step.tokensOut
                      ? ` · ${step.tokensIn.toLocaleString()} in / ${step.tokensOut.toLocaleString()} out`
                      : ""}
                    {step.promptVersion ? ` · ${step.promptVersion}` : ""}
                  </span>
                ) : null}
                {!running && (job.productId || job.articleId) ? (
                  <form action={rerunJob} className="ml-auto flex items-center gap-2">
                    <input type="hidden" name="jobId" value={job.id} />
                    <input type="hidden" name="step" value={name} />
                    <label className="flex items-center gap-1 text-xs text-muted">
                      <input type="checkbox" name="only" value="1" /> only this
                    </label>
                    <SubmitButton size="sm" variant="secondary" pendingLabel="…">
                      Re-run
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
              {step?.error ? <p className="mt-2 text-sm text-danger">{step.error}</p> : null}
              {step?.logs.length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted">Logs ({step.logs.length})</summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs">
                    {step.logs.map((l, i) => (
                      <li key={i}>
                        <span className="text-muted">{l.ts.slice(11, 19)}</span> {l.message}{" "}
                        {l.data ? <span className="text-muted">{JSON.stringify(l.data).slice(0, 400)}</span> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {step ? <JsonView value={step.output} label="Output" /> : null}
            </li>
          );
        })}
      </ol>
      <JsonView value={job.input} label="Intake" />
    </div>
  );
}
