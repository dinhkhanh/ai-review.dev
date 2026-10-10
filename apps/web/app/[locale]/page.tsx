import { localePath } from "@repo/content";
import { listCategoriesWithCounts, listPublishedArticles, listPublishedReviews } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { GuideGrid } from "../../components/guide-card";
import { ReviewGrid } from "../../components/review-card";
import { messagesFor, pageAlternates, pageLocale } from "../../lib/i18n";

// ISR; publishing also revalidates "/" on demand (FR-WEB-2).
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await pageLocale();
  return { alternates: await pageAlternates("/", locale) };
}

export default async function HomePage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const href = (path: string) => localePath(locale, path);
  const db = getDb();
  const [reviews, categories, guides] = await Promise.all([
    listPublishedReviews(db, { limit: 12, locale }),
    listCategoriesWithCounts(db, { locale }),
    listPublishedArticles(db, { types: ["comparison", "alternatives", "best_of"], limit: 6, locale }),
  ]);
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-24">
        <p className="text-sm font-medium text-brand">{t.home.kicker}</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">{t.home.title}</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">{t.site.description}</p>
        <p className="mt-4 max-w-2xl text-sm text-muted">
          {t.home.trust}{" "}
          <Link href={href("/editorial-policy")} className="underline">
            {t.home.howWeReview}
          </Link>
        </p>
      </section>

      {reviews.length > 0 ? (
        <section aria-labelledby="latest-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="latest-heading" className="text-xl font-semibold">
              {t.home.latest}
            </h2>
            <Link href={href("/reviews")} className="text-sm text-brand hover:underline">
              {t.home.allReviews}
            </Link>
          </div>
          <div className="mt-6">
            <ReviewGrid reviews={reviews} t={t} />
          </div>
        </section>
      ) : null}

      {guides.length > 0 ? (
        <section aria-labelledby="guides-heading" className="mt-16">
          <div className="flex items-baseline justify-between">
            <h2 id="guides-heading" className="text-xl font-semibold">
              {t.home.guides}
            </h2>
            <span className="flex gap-4 text-sm">
              <Link href={href("/compare")} className="text-brand hover:underline">
                {t.home.comparisons}
              </Link>
              <Link href={href("/best")} className="text-brand hover:underline">
                {t.home.bestOf}
              </Link>
            </span>
          </div>
          <div className="mt-6">
            <GuideGrid guides={guides} t={t} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="categories-heading" className="mt-16">
        <h2 id="categories-heading" className="text-xl font-semibold">
          {t.home.browse}
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <li key={c.id} className="relative rounded-lg border border-border bg-bg p-5 hover:border-brand/50">
              <h3 className="text-base font-semibold">
                <Link href={href(`/categories/${c.slug}`)} className="after:absolute after:inset-0">
                  {c.name}
                </Link>
              </h3>
              {c.description ? <p className="mt-1 text-sm text-muted">{c.description}</p> : null}
              <p className="mt-3 text-xs text-muted">{t.home.reviewCount(c.reviews)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
