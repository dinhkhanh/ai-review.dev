import Link from "next/link";
import { PromoCode } from "./promo-code";

export interface DealView {
  id: string;
  title: string;
  description: string | null;
  code: string | null;
  discountText: string | null;
  endsAt: Date | null;
  productName: string;
  reviewSlug?: string | null;
  /** Monetised CTA (go-link with placement), or null when the product has no go-slug. */
  href: string | null;
}

const endFmt = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** One deal (FR-WEB-8). CTAs are go-links: rel="sponsored nofollow noopener" (FR-AFF-6). */
export function DealCard({ deal }: { deal: DealView }) {
  return (
    <article className="flex h-full flex-col rounded-lg border border-border bg-bg p-5">
      {deal.discountText ? (
        <p className="w-fit rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
          {deal.discountText}
        </p>
      ) : null}
      <h3 className="mt-2 font-semibold leading-snug">{deal.title}</h3>
      {deal.description ? <p className="mt-1 text-sm text-muted">{deal.description}</p> : null}
      {deal.code ? (
        <div className="mt-3">
          <PromoCode code={deal.code} />
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
        {deal.href ? (
          <a
            href={deal.href}
            rel="sponsored nofollow noopener"
            target="_blank"
            className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg hover:opacity-90"
          >
            Get the deal
          </a>
        ) : null}
        {deal.reviewSlug ? (
          <Link href={`/reviews/${deal.reviewSlug}`} className="text-sm hover:underline">
            Read our {deal.productName} review
          </Link>
        ) : null}
      </div>
      {deal.endsAt ? <p className="mt-2 text-xs text-muted">Ends {endFmt(deal.endsAt)}</p> : null}
    </article>
  );
}
