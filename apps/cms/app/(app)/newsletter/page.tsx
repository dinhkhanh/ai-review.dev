import { getSetting, listDigestIssues, newsletterSubscriberStats } from "@repo/core";
import { getDb } from "@repo/db";
import { Input, Label } from "@repo/ui/input";
import Link from "next/link";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { Empty, fmtDate, Notice, PageHeader, StatusBadge, Table } from "../../../components/ui";
import { buildIssueAction } from "./actions";

export const metadata = { title: "Newsletter" };

const select = "h-10 rounded-md border border-border bg-bg px-2 text-sm";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekly digest (FR-WEB-9): subscribers per locale, issues, and building an issue on demand. */
export default async function NewsletterPage() {
  const db = getDb();
  const [stats, issues, policy, i18n] = await Promise.all([
    newsletterSubscriberStats(db),
    listDigestIssues(db),
    getSetting(db, "newsletter.digest"),
    getSetting(db, "i18n.policy"),
  ]);
  const canSend = !!process.env.RESEND_API_KEY && !!process.env.NOTIFY_EMAIL_FROM;
  const locales = i18n?.enabledLocales ?? ["en"];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Newsletter"
        subtitle="Weekly digest of new and refreshed articles per locale. Subscribers confirm by email (double opt-in)."
      />
      {!canSend ? (
        <Notice tone="error">
          Sending is off: set RESEND_API_KEY and NOTIFY_EMAIL_FROM. Issues can still be built and previewed.
        </Notice>
      ) : null}
      <p className="text-sm text-muted">
        {policy?.enabled
          ? `Builds every ${WEEKDAYS[policy.weekday]} at ${String(policy.hourUtc).padStart(2, "0")}:00 UTC for ${locales.join(", ")}; ${
              policy.autoSend ? "sends automatically" : "leaves a draft to approve"
            } (up to ${policy.maxItems} articles).`
          : "The weekly schedule is off (Settings → newsletter.digest). Build issues by hand below."}
      </p>

      <section>
        <h2 className="font-semibold">Subscribers</h2>
        {stats.length === 0 ? (
          <Empty>No subscribers yet.</Empty>
        ) : (
          <div className="mt-3">
            <Table head={["Locale", "Confirmed", "Awaiting confirmation", "Unsubscribed"]}>
              {stats.map((s) => (
                <tr key={s.locale} className="border-t border-border">
                  <td className="p-3 font-mono text-xs">{s.locale}</td>
                  <td className="p-3 tabular-nums">{s.confirmed}</td>
                  <td className="p-3 tabular-nums">{s.pending}</td>
                  <td className="p-3 tabular-nums">{s.unsubscribed}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-bg p-4">
        <h2 className="font-semibold">Build an issue</h2>
        <p className="mt-1 text-sm text-muted">
          Collects articles published or refreshed in the Monday–Sunday week of the chosen date (default: last week). An
          existing issue for that week opens instead unless you rebuild a draft.
        </p>
        <ActionForm action={buildIssueAction} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="locale">Locale</Label>
            <select id="locale" name="locale" className={select} defaultValue="en">
              {["en", "de"].map((l) => (
                <option key={l} value={l}>
                  {l}
                  {locales.includes(l as "en" | "de") ? "" : " (not public yet)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="week">Week containing</Label>
            <Input id="week" name="week" type="date" />
          </div>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="rebuild" /> Rebuild draft
          </label>
          <SubmitButton variant="secondary">Build</SubmitButton>
        </ActionForm>
      </section>

      <section>
        <h2 className="font-semibold">Issues</h2>
        {issues.length === 0 ? (
          <Empty>No issues yet.</Empty>
        ) : (
          <div className="mt-3">
            <Table head={["Week", "Locale", "Subject", "Status", "Delivered", "Sent / scheduled"]}>
              {issues.map((i) => (
                <tr key={i.id} className="border-t border-border align-top">
                  <td className="p-3 text-xs tabular-nums">
                    {i.periodStart} → {i.periodEnd}
                  </td>
                  <td className="p-3 font-mono text-xs">{i.locale}</td>
                  <td className="max-w-md p-3">
                    <Link href={`/newsletter/${i.id}`} className="font-medium hover:underline">
                      {i.subject}
                    </Link>
                    <p className="text-xs text-muted">{i.items.length} items</p>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={i.status} />
                  </td>
                  <td className="p-3 text-xs tabular-nums">
                    {i.delivered}/{i.recipients}
                    {i.failed ? <span className="text-danger"> · {i.failed} failed</span> : null}
                  </td>
                  <td className="p-3 text-xs tabular-nums">{fmtDate(i.sentAt ?? i.scheduledFor)}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
