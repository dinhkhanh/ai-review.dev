import { listNotifications, NOTIFICATION_EVENTS } from "@repo/core";
import { getDb } from "@repo/db";
import { Button } from "@repo/ui/button";
import Link from "next/link";
import { Empty, fmtDate, PageHeader, StatusBadge, Tabs } from "../../../components/ui";
import { markReadAction } from "./actions";

export const metadata = { title: "Notifications" };

const SEVERITY_STATUS = { info: "pending", success: "succeeded", warning: "paused", error: "failed" } as const;

/** Notification inbox (FR-CMS-8): every event lands here; email/webhook delivery follows Settings. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "unread" } = await searchParams;
  const rows = await listNotifications(getDb(), { unreadOnly: tab === "unread", limit: 200 });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="Job results, articles awaiting review, broken links, cost alerts and more. Channels are set in Settings."
        actions={
          tab === "unread" && rows.length ? (
            <form action={markReadAction}>
              <Button type="submit" size="sm" variant="secondary">
                Mark all read
              </Button>
            </form>
          ) : null
        }
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "unread", label: "Unread", href: "/notifications" },
          { key: "all", label: "All", href: "/notifications?tab=all" },
        ]}
      />
      {rows.length === 0 ? (
        <Empty>{tab === "unread" ? "Nothing new." : "No notifications yet."}</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id} className={`rounded-lg border border-border bg-bg p-4 ${n.readAt ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={SEVERITY_STATUS[n.severity]} />
                <span className="text-xs text-muted">
                  {NOTIFICATION_EVENTS[n.event as keyof typeof NOTIFICATION_EVENTS]?.label ?? n.event} ·{" "}
                  {fmtDate(n.createdAt)}
                </span>
                {!n.readAt ? (
                  <form action={markReadAction} className="ml-auto">
                    <input type="hidden" name="id" value={n.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      Mark read
                    </Button>
                  </form>
                ) : null}
              </div>
              <p className="mt-2 font-medium">
                {n.href ? (
                  <Link href={n.href} className="hover:underline">
                    {n.title}
                  </Link>
                ) : (
                  n.title
                )}
              </p>
              {n.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{n.body}</p> : null}
              {Object.keys(n.delivery).length ? (
                <p className="mt-2 text-xs text-muted">
                  {Object.entries(n.delivery)
                    .map(([channel, outcome]) => `${channel}: ${outcome}`)
                    .join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
