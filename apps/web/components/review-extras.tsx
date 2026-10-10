import { localePath } from "@repo/content";
import { dealsForProduct } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { currentLocale, messagesFor } from "../lib/i18n";
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
  path,
  title,
  productId,
  productName,
  goSlug,
}: {
  articleSlug: string;
  /** Public path of the article in its locale. */
  path: string;
  title: string;
  productId: string | null;
  productName: string | null;
  goSlug: string | null;
}) {
  const locale = await currentLocale();
  const t = messagesFor(locale);
  const deals = productId ? await dealsForProduct(getDb(), productId).catch(() => []) : [];
  return (
    <div className="mt-10 space-y-8">
      {deals.length ? (
        <section aria-labelledby="deals-box">
          <h2 id="deals-box" className="text-xl font-semibold">
            {t.extras.currentDeals(productName ?? "")}
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {deals.map((d) => (
              <li key={d.id}>
                <DealCard
                  t={t}
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
            <Link href={localePath(locale, "/deals")} className="underline">
              {t.extras.allDeals}
            </Link>
          </p>
        </section>
      ) : null}
      <div className="space-y-4 border-t border-border pt-6">
        <HelpfulVote
          articleSlug={articleSlug}
          locale={locale}
          returnTo={path}
          t={{
            helpful: t.extras.helpful,
            yes: t.extras.yes,
            no: t.extras.no,
            thanks: t.extras.thanks,
            voteError: t.extras.voteError,
          }}
        >
          <Turnstile size="compact" />
        </HelpfulVote>
        {/* Client components get plain strings only (message catalogues also hold functions). */}
        <ShareButtons
          url={absoluteUrl(path)}
          title={title}
          t={{
            share: t.extras.share,
            copyLink: t.extras.copyLink,
            linkCopied: t.extras.linkCopied,
            email: t.extras.email,
          }}
        />
      </div>
    </div>
  );
}
