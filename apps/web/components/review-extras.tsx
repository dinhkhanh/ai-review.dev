import { dealsForProduct } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { goHref } from "../lib/render";
import { absoluteUrl } from "../lib/site";
import { DealCard } from "./deal-card";
import { HelpfulVote } from "./helpful-vote";
import { ShareButtons } from "./share-buttons";
import { Turnstile } from "./turnstile";

/**
 * Below-the-article extras on review pages: current deals for the product (FR-WEB-8, placement
 * `deals_box`), "Was this helpful?" and share buttons (FR-WEB-10).
 */
export async function ReviewExtras({
  articleSlug,
  title,
  productId,
  productName,
  goSlug,
}: {
  articleSlug: string;
  title: string;
  productId: string | null;
  productName: string | null;
  goSlug: string | null;
}) {
  const deals = productId ? await dealsForProduct(getDb(), productId).catch(() => []) : [];
  const path = `/reviews/${articleSlug}`;
  return (
    <div className="mt-10 space-y-8">
      {deals.length ? (
        <section aria-labelledby="deals-box">
          <h2 id="deals-box" className="text-xl font-semibold">
            Current {productName ?? ""} deals
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {deals.map((d) => (
              <li key={d.id}>
                <DealCard
                  deal={{
                    ...d,
                    productName: productName ?? "",
                    href: goSlug ? goHref(articleSlug)(goSlug, "deals_box") : null,
                  }}
                />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            <Link href="/deals" className="underline">
              All deals
            </Link>
          </p>
        </section>
      ) : null}
      <div className="space-y-4 border-t border-border pt-6">
        <HelpfulVote articleSlug={articleSlug} returnTo={path}>
          <Turnstile size="compact" />
        </HelpfulVote>
        <ShareButtons url={absoluteUrl(path)} title={title} />
      </div>
    </div>
  );
}
