import { localizedArticlePath } from "@repo/content";
import type { AcceptanceCandidate, JobAcceptance } from "@repo/core";
import Link from "next/link";
import { fmtDate, StatusBadge } from "../ui";
import { CheckList, StatusChip, worstStatus } from "./checks";

const CRITERIA = [1, 2, 3, 4, 5, 6] as const;

/** Recent review jobs with one chip per SRS §8 criterion; each row expands to the checks. */
export function JobAcceptanceList({
  rows,
  siteUrl,
}: {
  rows: Array<{ candidate: AcceptanceCandidate; result: JobAcceptance }>;
  siteUrl: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_repeat(6,3.5rem)] gap-2 px-3 py-2 text-sm text-muted md:grid">
        <span>Job</span>
        <span>Article</span>
        {CRITERIA.map((n) => (
          <span key={n} className="text-center">
            §8 #{n}
          </span>
        ))}
      </div>
      {rows.map(({ candidate: c, result: r }) => (
        <details key={c.jobId} className="group border-t border-border">
          <summary className="grid cursor-pointer list-none grid-cols-1 gap-2 px-3 py-3 text-sm hover:bg-surface md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_repeat(6,3.5rem)] md:items-center [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="font-medium">{c.productName ?? "Unknown product"}</span>{" "}
              <span className="text-xs text-muted">
                {c.preset.replace(/_/g, " ")} · {fmtDate(c.createdAt)}
              </span>{" "}
              <StatusBadge status={c.status} />
            </span>
            <span className="min-w-0 truncate text-xs">
              {c.articleStatus ? (
                <StatusBadge status={c.articleStatus} />
              ) : (
                <span className="text-muted">no article</span>
              )}
            </span>
            <span className="flex flex-wrap gap-1 md:contents">
              {CRITERIA.map((n) => {
                const items = r.criteria.filter((i) => i.criterion === n);
                return (
                  <span key={n} className="md:text-center">
                    <StatusChip status={worstStatus(items)} label={`#${n}`} />
                  </span>
                );
              })}
            </span>
          </summary>
          <div className="space-y-3 border-t border-border bg-surface/40 px-3 py-3">
            <p className="flex flex-wrap gap-3 text-sm">
              <Link href={`/jobs/${c.jobId}`} className="underline">
                Job detail
              </Link>
              {c.articleId ? (
                <Link href={`/articles/${c.articleId}`} className="underline">
                  Article in the editor
                </Link>
              ) : null}
              {c.articleStatus === "published" && c.articleSlug ? (
                <a
                  href={`${siteUrl}${localizedArticlePath("review", c.articleSlug, c.articleLocale)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Live page
                </a>
              ) : null}
              <span className="text-muted">
                {r.summary.pass} pass · {r.summary.fail} fail · {r.summary.warn} warn · {r.summary["n/a"]} n/a
              </span>
            </p>
            {CRITERIA.map((n) => (
              <section key={n}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">SRS §8 criterion {n}</h3>
                <CheckList items={r.criteria.filter((i) => i.criterion === n)} />
              </section>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
