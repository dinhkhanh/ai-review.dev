import type { ArticleRenderData } from "@repo/core";
import Link from "next/link";

/**
 * Dead product handling (FR-MNT-4): when a reviewed product is discontinued, the page keeps its
 * history but says so up front and points readers to reviewed alternatives.
 */
export function DiscontinuedBanner({ data }: { data: ArticleRenderData }) {
  if (data.product?.status !== "discontinued") return null;
  const alternatives = data.competitors.filter((c) => c.reviewSlug).slice(0, 4);
  return (
    <div role="note" className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
      <p className="font-semibold">{data.product.name} is no longer available.</p>
      <p className="mt-1">
        {data.product.statusNote ?? "The product appears to have been discontinued."} This review is kept for reference;
        prices and features may no longer apply.
      </p>
      {alternatives.length ? (
        <p className="mt-2">
          Consider instead:{" "}
          {alternatives.map((c, i) => (
            <span key={c.productId}>
              {i > 0 ? ", " : ""}
              <Link href={`/reviews/${c.reviewSlug}`} className="font-medium underline">
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
