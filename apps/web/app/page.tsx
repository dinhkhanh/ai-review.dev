import { listCategoriesWithCounts, listPublishedArticles, listPublishedReviews } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { GuideGrid } from "../components/guide-card";
import { ReviewGrid } from "../components/review-card";
import { SITE } from "../lib/site";

// ISR; publishing also revalidates "/" on demand (FR-WEB-2).
export const revalidate = 300;

export default async function HomePage() {
  const db = getDb();
  const [reviews, categories, guides] = await Promise.all([
    listPublishedReviews(db, { limit: 12 }),
    listCategoriesWithCounts(db),
    listPublishedArticles(db, { types: ["comparison", "alternatives", "best_of"], limit: 6 }),
  ]);
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-24">
        <p className="text-sm font-medium text-brand">Independent, evidence-backed</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Find the right software before you pay for it.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">{SITE.description}</p>
        <p className="mt-4 max-w-2xl text-sm text-muted">
          Every review cites its sources, shows the date we verified prices, and is checked by our editor.{" "}
          <Link href="/editorial-policy" className="underline">
            How we review
          </Link>
        </p>
      </section>

      {reviews.length > 0 ? (
        <section aria-labelledby="latest-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="latest-heading" className="text-xl font-semibold">
              Latest reviews
            </h2>
            <Link href="/reviews" className="text-sm text-brand hover:underline">
              All reviews →
            </Link>
          </div>
          <div className="mt-6">
            <ReviewGrid reviews={reviews} />
          </div>
        </section>
      ) : null}

      {guides.length > 0 ? (
        <section aria-labelledby="guides-heading" className="mt-16">
          <div className="flex items-baseline justify-between">
            <h2 id="guides-heading" className="text-xl font-semibold">
              Comparisons and shortlists
            </h2>
            <span className="flex gap-4 text-sm">
              <Link href="/compare" className="text-brand hover:underline">
                Comparisons
              </Link>
              <Link href="/best" className="text-brand hover:underline">
                Best of
              </Link>
            </span>
          </div>
          <div className="mt-6">
            <GuideGrid guides={guides} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="categories-heading" className="mt-16">
        <h2 id="categories-heading" className="text-xl font-semibold">
          Browse by category
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <li key={c.id} className="relative rounded-lg border border-border bg-bg p-5 hover:border-brand/50">
              <h3 className="text-base font-semibold">
                <Link href={`/categories/${c.slug}`} className="after:absolute after:inset-0">
                  {c.name}
                </Link>
              </h3>
              {c.description ? <p className="mt-1 text-sm text-muted">{c.description}</p> : null}
              <p className="mt-3 text-xs text-muted">
                {c.reviews} review{c.reviews === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
