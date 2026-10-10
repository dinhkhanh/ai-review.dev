import { listErrorReports } from "@repo/core";
import { articles, getDb, inArray } from "@repo/db";
import { Button } from "@repo/ui/button";
import Link from "next/link";
import { Empty, fmtDate, PageHeader, StatusBadge, Table } from "../../../components/ui";
import { setReportStatusAction } from "./actions";

export const metadata = { title: "Reports" };

/** Visitor "report a change" submissions (FR-WEB-6): each one is a refresh task. */
export default async function ReportsPage() {
  const db = getDb();
  const reports = await listErrorReports(db);
  const ids = [...new Set(reports.map((r) => r.articleId).filter((x): x is string => !!x))];
  const arts = ids.length
    ? await db
        .select({ id: articles.id, title: articles.title, productId: articles.productId })
        .from(articles)
        .where(inArray(articles.id, ids))
    : [];
  const byId = new Map(arts.map((a) => [a.id, a]));
  return (
    <div className="space-y-6">
      <PageHeader title="Visitor reports" subtitle="Price changes and errors reported from review pages." />
      {reports.length === 0 ? (
        <Empty>No reports.</Empty>
      ) : (
        <Table head={["Received", "Article", "Kind", "Message", "Status", ""]}>
          {reports.map((r) => {
            const a = r.articleId ? byId.get(r.articleId) : undefined;
            return (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="p-3 tabular-nums">{fmtDate(r.createdAt)}</td>
                <td className="p-3">
                  {a ? (
                    <Link href={`/articles/${a.id}`} className="hover:underline">
                      {a.title}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-3">{r.kind}</td>
                <td className="max-w-md whitespace-pre-wrap p-3">
                  {r.message}
                  {r.email ? <p className="mt-1 text-xs text-muted">{r.email}</p> : null}
                </td>
                <td className="p-3">
                  <StatusBadge status={r.status === "open" ? "pending" : r.status} />
                </td>
                <td className="p-3">
                  <div className="flex flex-col gap-1">
                    {a?.productId ? (
                      <Link href={`/products/${a.productId}`} className="text-sm text-brand hover:underline">
                        Refresh product
                      </Link>
                    ) : null}
                    {r.status === "open"
                      ? (["resolved", "dismissed"] as const).map((s) => (
                          <form key={s} action={setReportStatusAction}>
                            <input type="hidden" name="reportId" value={r.id} />
                            <input type="hidden" name="status" value={s} />
                            <Button type="submit" size="sm" variant="ghost">
                              {s === "resolved" ? "Resolve" : "Dismiss"}
                            </Button>
                          </form>
                        ))
                      : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
