import { ARTICLE_TYPE_LABEL } from "@repo/content";
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

const LOCALES: Record<string, string> = { all: "All languages", en: "English", de: "German" };

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; locale?: string }>;
}) {
  const { view = "review", locale = "all" } = await searchParams;
  const current = VIEWS[view] ?? VIEWS.review!;
  const rows = await listArticles(getDb(), {
    status: current.statuses,
    locale: locale in LOCALES && locale !== "all" ? locale : null,
    limit: 200,
  });
  const href = (v: string, l: string) => `/articles?view=${v}${l === "all" ? "" : `&locale=${l}`}`;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Articles"
        subtitle="Review queue (FR-QA-2). Open an article to edit, preview, check QA and publish."
      />
      <Tabs
        active={view}
        tabs={Object.entries(VIEWS).map(([key, v]) => ({ key, label: v.label, href: href(key, locale) }))}
      />
      <nav className="flex gap-3 text-sm" aria-label="Language">
        {Object.entries(LOCALES).map(([key, label]) => (
          <Link
            key={key}
            href={href(view, key)}
            aria-current={key === locale ? "page" : undefined}
            className={key === locale ? "font-medium" : "text-muted hover:underline"}
          >
            {label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <Table head={["Title", "Lang", "Type", "Product", "Status", "Score", "Gates", "Updated", ""]}>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="p-3 font-medium">{a.title}</td>
              <td className="p-3 font-mono text-xs uppercase text-muted">{a.locale}</td>
              <td className="p-3 text-muted">{ARTICLE_TYPE_LABEL[a.type]}</td>
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
