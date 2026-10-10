import { getDashboardStats, listArticles, listErrorReports, listJobs } from "@repo/core";
import { getDb } from "@repo/db";
import { Card } from "@repo/ui/card";
import Link from "next/link";
import { Empty, fmtDate, StatusBadge, Table, usd } from "../../components/ui";

export const metadata = { title: "Dashboard" };

/** CMS dashboard (FR-CMS-2). */
export default async function DashboardPage() {
  const db = getDb();
  const [stats, jobs, review, reports] = await Promise.all([
    getDashboardStats(db),
    listJobs(db, 10),
    listArticles(db, { status: ["in_review", "changes_requested", "approved"], limit: 10 }),
    listErrorReports(db, { status: "open" }),
  ]);
  const tiles = [
    { label: "Jobs running", value: stats.jobsRunning, href: "/jobs" },
    { label: "Failed jobs (24h)", value: stats.jobsFailedLast24h, warn: stats.jobsFailedLast24h > 0, href: "/jobs" },
    { label: "Awaiting review", value: stats.articlesAwaitingReview, href: "/articles" },
    { label: "Published", value: stats.articlesPublished, href: "/articles?view=published" },
    { label: "Clicks today", value: stats.clicksToday, href: "/affiliate?view=clicks" },
    { label: "Revenue (30 days)", value: usd.format(stats.revenue30dUsd), href: "/affiliate" },
    { label: "AI spend this month", value: usd.format(stats.spendThisMonthUsd), href: "/jobs" },
    { label: "Open visitor reports", value: reports.length, warn: reports.length > 0, href: "/reports" },
  ];
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link
          href="/intake"
          className="inline-flex h-9 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-fg"
        >
          New review
        </Link>
      </div>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key numbers">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="h-full hover:border-brand/50">
              <p className="text-sm text-muted">{t.label}</p>
              <p className={`mt-2 text-2xl font-semibold tabular-nums ${t.warn ? "text-danger" : ""}`}>{t.value}</p>
            </Card>
          </Link>
        ))}
      </section>
      <div className="grid gap-8 xl:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold">Review queue</h2>
          <div className="mt-3">
            {review.length === 0 ? (
              <Empty>Nothing waiting for review.</Empty>
            ) : (
              <Table head={["Article", "Status", "Score", "Gates"]}>
                {review.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="p-3">
                      <Link href={`/articles/${a.id}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                    </td>
                    <td className="p-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="p-3 tabular-nums">{a.overallScore?.toFixed(1) ?? "—"}</td>
                    <td className="p-3">{a.hardGatesPassed ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        </section>
        <section>
          <h2 className="text-lg font-semibold">Recent jobs</h2>
          <div className="mt-3">
            {jobs.length === 0 ? (
              <Empty>No review jobs yet.</Empty>
            ) : (
              <Table head={["Created", "Product", "Status", "Cost"]}>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t border-border">
                    <td className="p-3 tabular-nums">
                      <Link href={`/jobs/${j.id}`} className="hover:underline">
                        {fmtDate(j.createdAt)}
                      </Link>
                    </td>
                    <td className="p-3">{j.productName ?? String((j.input as { url?: string }).url ?? "—")}</td>
                    <td className="p-3">
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="p-3 tabular-nums">{usd.format(Number(j.totalCostUsd))}</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
