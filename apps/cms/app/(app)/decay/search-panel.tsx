import { articleSearchSeries, topQueriesForArticles } from "@repo/core";
import { getDb } from "@repo/db";

const fmtPos = (p: number | null | undefined) => (p == null ? "–" : p.toFixed(1));
const num = new Intl.NumberFormat("en-US");

/**
 * Search Console summary for one article (FR-MNT-3): last 28 days vs the 28 before, plus top
 * queries. A server component the article page can mount: `<ArticleSearchPanel articleId={id} />`.
 */
export async function ArticleSearchPanel({ articleId }: { articleId: string }) {
  const db = getDb();
  const [series, queries] = await Promise.all([
    articleSearchSeries(db, articleId, { days: 56 }),
    topQueriesForArticles(db, [articleId], 10),
  ]);
  if (series.length === 0) {
    return <p className="text-sm text-muted">No Search Console data for this page yet.</p>;
  }
  const latest = series.at(-1)!.day;
  const cutoff = new Date(Date.parse(`${latest}T00:00:00Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
  const sum = (rows: typeof series) => {
    const clicks = rows.reduce((n, r) => n + r.clicks, 0);
    const impressions = rows.reduce((n, r) => n + r.impressions, 0);
    const posSum = rows.reduce((n, r) => n + (r.position ?? 0) * r.impressions, 0);
    return { clicks, impressions, position: impressions ? posSum / impressions : null };
  };
  const cur = sum(series.filter((r) => r.day >= cutoff));
  const prev = sum(series.filter((r) => r.day < cutoff));
  const top = queries.get(articleId) ?? [];
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-3 gap-3">
        <Metric label="Clicks (28 d)" now={num.format(cur.clicks)} before={num.format(prev.clicks)} />
        <Metric label="Impressions" now={num.format(cur.impressions)} before={num.format(prev.impressions)} />
        <Metric label="Avg. position" now={fmtPos(cur.position)} before={fmtPos(prev.position)} />
      </dl>
      {top.length ? (
        <ol className="list-decimal space-y-0.5 pl-5 text-xs">
          {top.map((q) => (
            <li key={q.query}>
              {q.query}{" "}
              <span className="text-muted">
                · {q.clicks} clicks · pos {fmtPos(q.position)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="text-xs text-muted">Data through {latest}.</p>
    </div>
  );
}

function Metric({ label, now, before }: { label: string; now: string; before: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{now}</dd>
      <dd className="text-xs text-muted tabular-nums">before: {before}</dd>
    </div>
  );
}
