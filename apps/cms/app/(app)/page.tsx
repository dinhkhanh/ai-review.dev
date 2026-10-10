import { getDashboardStats, listJobs } from "@repo/core";
import { getDb } from "@repo/db";
import { Badge } from "@repo/ui/badge";
import { Card } from "@repo/ui/card";

export const metadata = { title: "Dashboard" };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default async function DashboardPage() {
  const db = getDb();
  const [stats, jobs] = await Promise.all([getDashboardStats(db), listJobs(db, 10)]);
  const tiles = [
    { label: "Products", value: stats.products },
    { label: "Jobs running", value: stats.jobsRunning },
    { label: "Failed jobs (24h)", value: stats.jobsFailedLast24h, warn: stats.jobsFailedLast24h > 0 },
    { label: "Awaiting review", value: stats.articlesAwaitingReview },
    { label: "Published", value: stats.articlesPublished },
    { label: "Clicks today", value: stats.clicksToday },
    { label: "AI spend this month", value: usd.format(stats.spendThisMonthUsd) },
  ];
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key numbers">
        {tiles.map((t) => (
          <Card key={t.label}>
            <p className="text-sm text-muted">{t.label}</p>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${t.warn ? "text-danger" : ""}`}>{t.value}</p>
          </Card>
        ))}
      </section>
      <section>
        <h2 className="text-lg font-semibold">Recent jobs</h2>
        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No review jobs yet. Product intake arrives in Phase 1.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-bg">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="p-3 font-medium">Created</th>
                  <th className="p-3 font-medium">Preset</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t border-border">
                    <td className="p-3 tabular-nums">{j.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td className="p-3">{j.preset}</td>
                    <td className="p-3">
                      <Badge tone={j.status === "failed" ? "danger" : j.status === "succeeded" ? "success" : "neutral"}>
                        {j.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right tabular-nums">{usd.format(Number(j.totalCostUsd))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
