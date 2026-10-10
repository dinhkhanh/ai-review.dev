import { listPublishedReviews, searchPublishedReviews } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import { ReviewGrid } from "../../components/review-card";

export const metadata: Metadata = {
  title: "All reviews",
  description: "Every software review we have published, newest first.",
};

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = q?.trim().slice(0, 100) ?? "";
  const db = getDb();
  const reviews = query ? await searchPublishedReviews(db, query, 50) : await listPublishedReviews(db, { limit: 100 });
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{query ? `Reviews matching “${query}”` : "All reviews"}</h1>
      <form action="/reviews" method="get" role="search" className="mt-6 flex max-w-md gap-2">
        <label htmlFor="q" className="sr-only">
          Search reviews
        </label>
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder="Search by product name"
          className="h-10 flex-1 rounded-md border border-border bg-bg px-3 text-sm"
        />
        <button className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">Search</button>
      </form>
      <div className="mt-8">
        {reviews.length ? <ReviewGrid reviews={reviews} /> : <p className="text-muted">No reviews found yet.</p>}
      </div>
    </div>
  );
}
