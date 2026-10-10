import { listJobs } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { Empty, fmtDate, PageHeader, StatusBadge, Table, usd } from "../../../components/ui";

export const metadata = { title: "Jobs" };

export default async function JobsPage() {
  const jobs = await listJobs(getDb(), 100);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        actions={
          <Link
            href="/intake"
            className="inline-flex h-9 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-fg"
          >
            New review
          </Link>
        }
      />
      {jobs.length === 0 ? (
        <Empty>No jobs yet.</Empty>
      ) : (
        <Table head={["Created", "Product", "Preset", "Status", "Cost", ""]}>
          {jobs.map((j) => (
            <tr key={j.id} className="border-t border-border">
              <td className="p-3 tabular-nums">{fmtDate(j.createdAt)}</td>
              <td className="p-3">{j.productName ?? String((j.input as { url?: string }).url ?? "—")}</td>
              <td className="p-3">{j.preset.replace("_", " ")}</td>
              <td className="p-3">
                <StatusBadge status={j.status} />
              </td>
              <td className="p-3 tabular-nums">{usd.format(Number(j.totalCostUsd))}</td>
              <td className="p-3 text-right">
                <Link href={`/jobs/${j.id}`} className="text-brand hover:underline">
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
