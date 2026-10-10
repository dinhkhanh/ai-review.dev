import type { ArticleRenderData } from "@repo/core";
import Link from "next/link";
import { messagesFor } from "../lib/messages";
import { reviewPath } from "../lib/render";

/**
 * Dead product handling (FR-MNT-4): when a reviewed product is discontinued, the page keeps its
 * history but says so up front and points readers to reviewed alternatives.
 */
export function DiscontinuedBanner({ data }: { data: ArticleRenderData }) {
  if (data.product?.status !== "discontinued") return null;
  const alternatives = data.competitors.filter((c) => c.reviewSlug).slice(0, 4);
  const t = messagesFor(data.article.locale).discontinued;
  return (
    <div role="note" className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
      <p className="font-semibold">{t.gone(data.product.name)}</p>
      <p className="mt-1">
        {data.product.statusNote ?? t.fallbackNote} {t.kept}
      </p>
      {alternatives.length ? (
        <p className="mt-2">
          {t.consider}{" "}
          {alternatives.map((c, i) => (
            <span key={c.productId}>
              {i > 0 ? ", " : ""}
              <Link href={reviewPath(c.reviewSlug!, data.article.locale)} className="font-medium underline">
                {c.name}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}
    </div>
  );
}
