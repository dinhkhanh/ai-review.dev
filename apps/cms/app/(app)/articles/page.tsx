import { listArticles, type ArticleStatus } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { Empty, fmtDate, PageHeader, StatusBadge, Table, Tabs } from "../../../components/ui";

export const metadata = { title: "Articles" };

const VIEWS: Record<string, { label: string; statuses: ArticleStatus[] }> = {
  review: { label: "Awaiting review", statuses: ["in_review"] },
  changes: { label: "Changes requested", statuses: ["changes_requested"] },
  approved: { label: "Approved / scheduled", statuses: ["approved", "scheduled"] },
  published: { label: "Published", statuses: ["published"] },
  drafts: { label: "Drafts", statuses: ["draft"] },
  all: { label: "All", statuses: [] },
};

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "review" } = await searchParams;
  const current = VIEWS[view] ?? VIEWS.review!;
  const rows = await listArticles(getDb(), { status: current.statuses, limit: 200 });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Articles"
        subtitle="Review queue (FR-QA-2). Open an article to edit, preview, check QA and publish."
      />
      <Tabs
        active={view}
        tabs={Object.entries(VIEWS).map(([key, v]) => ({ key, label: v.label, href: `/articles?view=${key}` }))}
      />
      {rows.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <Table head={["Title", "Product", "Status", "Score", "Gates", "Updated", ""]}>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="p-3 font-medium">{a.title}</td>
              <td className="p-3">{a.productName ?? "—"}</td>
              <td className="p-3">
                <StatusBadge status={a.status} />
              </td>
              <td className="p-3 tabular-nums">{a.overallScore?.toFixed(1) ?? "—"}</td>
              <td className="p-3">{a.hardGatesPassed === null ? "—" : a.hardGatesPassed ? "✓ pass" : "✗ fail"}</td>
              <td className="p-3 tabular-nums">{fmtDate(a.updatedAt)}</td>
              <td className="p-3 text-right">
                <Link href={`/articles/${a.id}`} className="text-brand hover:underline">
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
