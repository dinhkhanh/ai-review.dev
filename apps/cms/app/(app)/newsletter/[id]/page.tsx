import {
  digestDeliveryCounts,
  getDigestIssue,
  itemKey,
  listDigestFailures,
  newsletterEnvFromProcess,
  newsletterPageUrl,
  renderDigestEmail,
  type DigestItem,
} from "@repo/core";
import { getDb } from "@repo/db";
import { Input, Label } from "@repo/ui/input";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "../../../../components/action-form";
import { AutoRefresh } from "../../../../components/auto-refresh";
import { SubmitButton } from "../../../../components/submit-button";
import { fmtDate, Notice, PageHeader, StatusBadge, Table } from "../../../../components/ui";
import { retryFailedAction, scheduleAction, sendNowAction, sendTestAction, updateIssueAction } from "../actions";

export const metadata = { title: "Newsletter issue" };

const field = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm";

/** One digest issue (FR-WEB-9): edit, preview, test, send or schedule, delivery stats. */
export default async function NewsletterIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const issue = await getDigestIssue(db, id);
  if (!issue) notFound();
  const [counts, failures] = await Promise.all([digestDeliveryCounts(db, id), listDigestFailures(db, id, 20)]);
  const env = newsletterEnvFromProcess();
  const preview = renderDigestEmail(issue, {
    siteUrl: env.siteUrl,
    unsubscribeUrl: newsletterPageUrl(env, issue.locale, "unsubscribe", "preview"),
  });
  const items = issue.items as DigestItem[];
  const editable = ["draft", "scheduled", "failed"].includes(issue.status);
  const canSend = !!process.env.RESEND_API_KEY && !!process.env.NOTIFY_EMAIL_FROM;

  return (
    <div className="space-y-8">
      <AutoRefresh active={issue.status === "sending"} />
      <PageHeader
        title={issue.subject}
        subtitle={
          <>
            <Link href="/newsletter" className="hover:underline">
              Newsletter
            </Link>{" "}
            · {issue.locale} · week {issue.periodStart} → {issue.periodEnd}
          </>
        }
        actions={<StatusBadge status={issue.status} />}
      />
      {issue.error ? <Notice tone="error">{issue.error}</Notice> : null}
      {!canSend ? <Notice tone="error">Sending is off: set RESEND_API_KEY and NOTIFY_EMAIL_FROM.</Notice> : null}

      <section className="grid gap-4 sm:grid-cols-4">
        {[
          ["Recipients", issue.recipients],
          ["Delivered", counts.sent],
          ["Failed", counts.failed],
          ["In flight", counts.pending],
        ].map(([label, n]) => (
          <div key={label} className="rounded-lg border border-border bg-bg p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{n}</p>
          </div>
        ))}
      </section>
      <p className="text-xs text-muted">
        Sent {fmtDate(issue.sentAt)} · scheduled {fmtDate(issue.scheduledFor)} (UTC)
      </p>

      {editable ? (
        <section className="rounded-lg border border-border bg-bg p-4">
          <h2 className="font-semibold">Content</h2>
          <ActionForm action={updateIssueAction} className="mt-3 space-y-4">
            <input type="hidden" name="issueId" value={issue.id} />
            <div>
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" name="subject" defaultValue={issue.subject} maxLength={150} required />
            </div>
            <div>
              <Label htmlFor="intro">Intro (optional; blank lines separate paragraphs)</Label>
              <textarea
                id="intro"
                name="intro"
                rows={4}
                maxLength={2000}
                defaultValue={issue.intro ?? ""}
                className={field}
              />
            </div>
            <Table head={["Keep", "Order", "Item"]}>
              {items.map((item, index) => {
                const key = itemKey(item);
                return (
                  <tr key={key} className="border-t border-border align-top">
                    <td className="p-3">
                      <label className="sr-only" htmlFor={`keep_${key}`}>
                        Keep
                      </label>
                      <input id={`keep_${key}`} type="checkbox" name={`keep_${key}`} defaultChecked />
                    </td>
                    <td className="w-20 p-3">
                      <label className="sr-only" htmlFor={`pos_${key}`}>
                        Position
                      </label>
                      <Input id={`pos_${key}`} name={`pos_${key}`} type="number" min={1} defaultValue={index + 1} />
                    </td>
                    <td className="p-3 text-sm">
                      <span className="mr-2 text-xs uppercase text-muted">{item.kind}</span>
                      {item.kind === "deal" ? (
                        <>
                          {item.productName}: {item.discountText ?? item.title}
                        </>
                      ) : (
                        <>
                          <a href={item.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                            {item.title}
                          </a>
                          {item.summary ? <p className="text-xs text-muted">{item.summary}</p> : null}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <SubmitButton variant="secondary">Save</SubmitButton>
          </ActionForm>
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-bg p-4">
        <h2 className="font-semibold">Send</h2>
        <div className="mt-3 flex flex-wrap items-start gap-6">
          <ActionForm action={sendTestAction}>
            <input type="hidden" name="issueId" value={issue.id} />
            <SubmitButton variant="secondary" disabled={!canSend}>
              Send me a test
            </SubmitButton>
          </ActionForm>
          {issue.status !== "sent" ? (
            <ActionForm action={sendNowAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="issueId" value={issue.id} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="confirm" /> Send to all {issue.locale} subscribers
              </label>
              <SubmitButton disabled={!canSend} pendingLabel="Sending…">
                {issue.status === "failed" || issue.status === "sending" ? "Resume sending" : "Send now"}
              </SubmitButton>
            </ActionForm>
          ) : null}
          {editable ? (
            <ActionForm action={scheduleAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="issueId" value={issue.id} />
              <div>
                <Label htmlFor="at">Schedule (UTC)</Label>
                <Input id="at" name="at" type="datetime-local" />
              </div>
              <SubmitButton variant="secondary">
                {issue.status === "scheduled" ? "Reschedule / unschedule" : "Schedule"}
              </SubmitButton>
            </ActionForm>
          ) : null}
          {counts.failed > 0 ? (
            <ActionForm action={retryFailedAction}>
              <input type="hidden" name="issueId" value={issue.id} />
              <SubmitButton variant="ghost">Retry failed deliveries</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-muted">
          Each subscriber gets the issue at most once, even if a send is interrupted and resumed. Leave the time empty
          to unschedule.
        </p>
      </section>

      {failures.length ? (
        <section>
          <h2 className="font-semibold">Failed deliveries</h2>
          <div className="mt-3">
            <Table head={["Email", "Error", "When"]}>
              {failures.map((f) => (
                <tr key={`${f.email}-${f.at.toISOString()}`} className="border-t border-border">
                  <td className="p-3 text-sm">{f.email}</td>
                  <td className="p-3 text-xs text-danger">{f.error}</td>
                  <td className="p-3 text-xs">{fmtDate(f.at)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="font-semibold">Preview</h2>
        <iframe
          title="Email preview"
          srcDoc={preview.html}
          sandbox=""
          className="mt-3 h-[48rem] w-full max-w-[640px] rounded-lg border border-border bg-white"
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-brand">Plain-text part</summary>
          <pre className="mt-2 max-w-[640px] whitespace-pre-wrap rounded-md bg-surface p-3 text-xs">{preview.text}</pre>
        </details>
      </section>
    </div>
  );
}
