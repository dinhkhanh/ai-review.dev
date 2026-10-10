import { localizedArticlePath } from "@repo/content";
import type { ReviewCard as ReviewCardData } from "@repo/core";
import { ScoreBadge } from "@repo/ui/article";
import Link from "next/link";
import { formatDate, type Messages } from "../lib/messages";

export function ReviewCard({ review, t }: { review: ReviewCardData; t: Messages }) {
  return (
    <article className="flex h-full flex-col rounded-lg border border-border bg-bg p-5 transition-colors hover:border-brand/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {review.categoryName ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{review.categoryName}</p>
          ) : null}
          <h3 className="mt-1 text-base font-semibold leading-snug">
            <Link
              href={localizedArticlePath("review", review.slug, review.locale)}
              className="after:absolute after:inset-0 hover:underline"
            >
              {review.title}
            </Link>
          </h3>
        </div>
        {typeof review.overallScore === "number" ? (
          <ScoreBadge score={review.overallScore} size="sm" label={t.render.score} />
        ) : null}
      </div>
      {review.metaDescription ? <p className="mt-2 line-clamp-3 text-sm text-muted">{review.metaDescription}</p> : null}
      {review.lastVerifiedAt ? (
        <p className="mt-auto pt-3 text-xs text-muted">
          {t.card.verified(formatDate(t, review.lastVerifiedAt, "month"))}
        </p>
      ) : null}
    </article>
  );
}

export function ReviewGrid({ reviews, t }: { reviews: ReviewCardData[]; t: Messages }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {reviews.map((r) => (
        <li key={r.id} className="relative">
          <ReviewCard review={r} t={t} />
        </li>
      ))}
    </ul>
  );
}
