import Link from "next/link";
import { formatDate, type Messages } from "../lib/messages";
import { PromoCode } from "./promo-code";

export interface DealView {
  id: string;
  title: string;
  description: string | null;
  code: string | null;
  discountText: string | null;
  endsAt: Date | null;
  productName: string;
  /** Review in the page locale, if any. */
  reviewHref?: string | null;
  /** Monetised CTA (go-link with placement), or null when the product has no go-slug. */
  href: string | null;
}

/** One deal (FR-WEB-8). CTAs are go-links: rel="sponsored nofollow noopener" (FR-AFF-6). */
export function DealCard({ deal, t }: { deal: DealView; t: Messages }) {
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
          <PromoCode code={deal.code} copyLabel={t.deals.copyCode} copiedLabel={t.deals.copied} />
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
        {deal.href ? (
          <span className="inline-flex flex-col items-start gap-0.5">
            {t.ads.label ? (
              <span className="text-[0.65rem] uppercase tracking-wide text-muted">{t.ads.label}</span>
            ) : null}
            <a
              href={deal.href}
              rel="sponsored nofollow noopener"
              target="_blank"
              className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg hover:opacity-90"
            >
              {t.deals.getDeal}
              {t.ads.marker || null}
            </a>
          </span>
        ) : null}
        {deal.reviewHref ? (
          <Link href={deal.reviewHref} className="text-sm hover:underline">
            {t.deals.readReview(deal.productName)}
          </Link>
        ) : null}
      </div>
      {deal.endsAt ? (
        <p className="mt-2 text-xs text-muted">{t.deals.ends(formatDate(t, deal.endsAt, "short"))}</p>
      ) : null}
    </article>
  );
}
