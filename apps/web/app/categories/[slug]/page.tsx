import { getCategoryBySlug, listPublishedArticles, listPublishedReviews } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideGrid } from "../../../components/guide-card";
import { ReviewGrid } from "../../../components/review-card";
import { absoluteUrl } from "../../../lib/site";

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(getDb(), slug);
  if (!category) return { title: "Category not found" };
  return {
    title: `${category.name} reviews`,
    description: category.description ?? `Independent reviews of ${category.name.toLowerCase()} software.`,
    alternates: { canonical: absoluteUrl(`/categories/${category.slug}`) },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const category = await getCategoryBySlug(db, slug);
  if (!category) notFound();
  const [reviews, guides] = await Promise.all([
    listPublishedReviews(db, { categorySlug: slug, limit: 100 }),
    listPublishedArticles(db, { categorySlug: slug, types: ["best_of", "comparison", "alternatives"], limit: 24 }),
  ]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/" className="hover:underline">
          Home
        </Link>{" "}
        / {category.name}
      </nav>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{category.name} reviews</h1>
      {category.description ? <p className="mt-2 max-w-2xl text-muted">{category.description}</p> : null}
      {guides.length ? (
        <section aria-labelledby="guides-heading" className="mt-8">
          <h2 id="guides-heading" className="text-xl font-semibold">
            Comparisons and shortlists
          </h2>
          <div className="mt-4">
            <GuideGrid guides={guides} />
          </div>
        </section>
      ) : null}
      <div className="mt-8">
        {reviews.length ? (
          <ReviewGrid reviews={reviews} />
        ) : (
          <p className="text-muted">We have not published reviews in this category yet. Check back soon.</p>
        )}
      </div>
    </div>
  );
}
