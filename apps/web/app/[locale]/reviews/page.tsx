import { localePath } from "@repo/content";
import { listPublishedReviews, searchPublishedReviews } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import { ReviewGrid } from "../../../components/review-card";
import { messagesFor, pageAlternates, pageLocale } from "../../../lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  return {
    title: t.reviews.title,
    description: t.reviews.description,
    alternates: await pageAlternates("/reviews", locale),
  };
}

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const { q } = await searchParams;
  const query = q?.trim().slice(0, 100) ?? "";
  const db = getDb();
  const reviews = query
    ? await searchPublishedReviews(db, query, 50, locale)
    : await listPublishedReviews(db, { limit: 100, locale });
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{query ? t.reviews.matching(query) : t.reviews.title}</h1>
      <form action={localePath(locale, "/reviews")} method="get" role="search" className="mt-6 flex max-w-md gap-2">
        <label htmlFor="q" className="sr-only">
          {t.reviews.searchLabel}
        </label>
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder={t.reviews.placeholder}
          className="h-10 flex-1 rounded-md border border-border bg-bg px-3 text-sm"
        />
        <button className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">{t.reviews.search}</button>
      </form>
      <div className="mt-8">
        {reviews.length ? <ReviewGrid reviews={reviews} t={t} /> : <p className="text-muted">{t.reviews.none}</p>}
      </div>
    </div>
  );
}
