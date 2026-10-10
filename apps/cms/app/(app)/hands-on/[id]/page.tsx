import { getHandsOnSession, handsOnFindingsSchema, type HandsOnAction } from "@repo/core";
import { getDb } from "@repo/db";
import { mediaUrl } from "@repo/media/urls";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "../../../../components/auto-refresh";
import { duration, fmtDate, JsonView, Notice, PageHeader, StatusBadge, Table, usd4 } from "../../../../components/ui";
import { stopReasonLabel } from "../labels";

export const metadata = { title: "Hands-on session" };

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">Nothing recorded.</p>
      )}
    </div>
  );
}

/** One trial session (FR-RES-7): findings, screenshots and the redacted action log. */
export default async function HandsOnSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getHandsOnSession(getDb(), id);
  if (!session) notFound();
  const findings = handsOnFindingsSchema.safeParse(session.findings);
  const actions = session.actions as unknown as HandsOnAction[];
  const live = session.status === "queued" || session.status === "running";

  return (
    <div className="space-y-6">
      <AutoRefresh active={live} />
      <PageHeader
        title={`Hands-on trial: ${session.productName}`}
        subtitle={
          <>
            <StatusBadge status={session.status} /> · started {fmtDate(session.startedAt ?? session.createdAt)} ·{" "}
            {duration(session.startedAt, session.finishedAt)} · {usd4.format(Number(session.costUsd))}
            {session.jobId ? (
              <>
                {" · "}
                <Link href={`/jobs/${session.jobId}`} className="underline">
                  job
                </Link>
              </>
            ) : null}
            {" · "}
            <Link href={`/products/${session.productId}`} className="underline">
              product
            </Link>
          </>
        }
      />
      {session.stopReason ? (
        <Notice tone={session.status === "failed" ? "error" : "info"}>
          Stopped: {stopReasonLabel(session.stopReason)}
        </Notice>
      ) : null}

      {findings.success ? (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <h2 className="text-lg font-semibold">Findings</h2>
          <p className="text-sm">{findings.data.summary}</p>
          <p className="text-sm text-muted">
            Signed up: {findings.data.signedUp ? "yes" : "no"}
            {findings.data.planObserved ? ` · plan: ${findings.data.planObserved}` : ""}
            {findings.data.timeToValueMinutes !== null
              ? ` · time to value: ~${findings.data.timeToValueMinutes} min`
              : ""}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <List title="Onboarding" items={findings.data.onboardingSteps} />
            <List title="Features seen working" items={findings.data.observedFeatures} />
            <List title="Limits and upsells" items={findings.data.limits} />
            <List title="Usability" items={findings.data.uiNotes} />
          </div>
          <p className="text-xs text-muted">
            Saved as a first-party source on the product; the next review or refresh extracts and cites it.
          </p>
        </section>
      ) : live ? (
        <Notice>Session in progress; this page refreshes.</Notice>
      ) : null}

      {session.screenshots.length ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Screenshots</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {session.screenshots.map((shot) => (
              <figure key={shot.id} className="rounded-lg border border-border p-2">
                <a href={mediaUrl(shot)} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(shot, "card")} alt={shot.alt ?? ""} className="w-full rounded object-cover" />
                </a>
                <figcaption className="mt-1 text-xs">
                  {shot.alt}{" "}
                  <Link href={`/media/${shot.id}`} className="text-muted hover:underline">
                    (media)
                  </Link>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Action log</h2>
        <p className="text-xs text-muted">Credentials appear only as placeholders such as {"{{identity.password}}"}.</p>
        <Table head={["#", "Action", "Target", "Result"]}>
          {actions.map((a, i) => (
            <tr key={i} className="border-t border-border align-top">
              <td className="p-3 tabular-nums">{a.step}</td>
              <td className="p-3 font-mono text-xs">{a.action}</td>
              <td className="max-w-md break-all p-3 text-xs">
                {a.target ?? a.url ?? ""}
                {a.value ? <span className="ml-1 text-muted">“{a.value}”</span> : null}
              </td>
              <td className="max-w-md p-3 text-xs">{a.result}</td>
            </tr>
          ))}
        </Table>
        <JsonView value={session.findings} label="Findings JSON" />
      </section>
    </div>
  );
}
