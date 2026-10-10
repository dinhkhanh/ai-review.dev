import { listProducts } from "@repo/core";
import { categories, getDb } from "@repo/db";
import Link from "next/link";
import { Empty, fmtDate, PageHeader, StatusBadge, Table } from "../../../components/ui";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const db = getDb();
  const rows = await listProducts(db, { limit: 200 });
  const cats = new Map((await db.select().from(categories)).map((c) => [c.id, c.name]));
  return (
    <div className="space-y-6">
      <PageHeader title="Products" subtitle="Reviewed products and the competitors discovered for them (draft)." />
      {rows.length === 0 ? (
        <Empty>No products yet. Start with a new review.</Empty>
      ) : (
        <Table head={["Name", "Domain", "Category", "Status", "Researched", ""]}>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="p-3 font-medium">{p.name}</td>
              <td className="p-3 text-muted">{p.domain}</td>
              <td className="p-3">{p.categoryId ? cats.get(p.categoryId) : "—"}</td>
              <td className="p-3">
                <StatusBadge status={p.status} />
              </td>
              <td className="p-3 tabular-nums">{fmtDate(p.lastResearchedAt)}</td>
              <td className="p-3 text-right">
                <Link href={`/products/${p.id}`} className="text-brand hover:underline">
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
