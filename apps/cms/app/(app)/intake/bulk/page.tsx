import { listBatchJobs, listCategories } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { AutoRefresh } from "../../../../components/auto-refresh";
import { Notice, PageHeader, StatusBadge, Table, Tabs, usd } from "../../../../components/ui";
import { BulkForm } from "./bulk-form";

export const metadata = { title: "Bulk intake" };

export default async function BulkIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; skipped?: string; errors?: string }>;
}) {
  const { batch, skipped, errors } = await searchParams;
  const db = getDb();
  const [categories, jobs] = await Promise.all([
    listCategories(db),
    batch && /^[0-9a-f-]{36}$/i.test(batch) ? listBatchJobs(db, batch) : Promise.resolve([]),
  ]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  return (
    <div className="space-y-6">
      <AutoRefresh active={active} />
      <PageHeader title="New review" subtitle="Paste a list or a CSV: every product becomes its own job (FR-INT-2)." />
      <IntakeTabs active="bulk" />
      {batch ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Batch: {jobs.length} job(s)</h2>
          {skipped ? <Notice>Skipped: {skipped}</Notice> : null}
          {errors ? <Notice tone="error">Rows not accepted: {errors}</Notice> : null}
          <Table head={["Product", "Status", "Cost", "Error"]}>
            {jobs.map((j) => {
              const input = j.input as { url?: string; name?: string };
              return (
                <tr key={j.id} className="border-t border-border">
                  <td className="p-3">
                    <Link href={`/jobs/${j.id}`} className="hover:underline">
                      {j.productName ?? input.name ?? input.url}
                    </Link>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="p-3 tabular-nums">{usd.format(Number(j.totalCostUsd))}</td>
                  <td className="max-w-md truncate p-3 text-danger">{j.error ?? ""}</td>
                </tr>
              );
            })}
          </Table>
        </section>
      ) : null}
      <BulkForm categories={categories} />
    </div>
  );
}

export function IntakeTabs({ active }: { active: "single" | "bulk" | "derivative" }) {
  return (
    <Tabs
      active={active}
      tabs={[
        { key: "single", label: "Single product", href: "/intake" },
        { key: "bulk", label: "Bulk", href: "/intake/bulk" },
        { key: "derivative", label: "Comparison or list", href: "/intake/derivative" },
      ]}
    />
  );
}
