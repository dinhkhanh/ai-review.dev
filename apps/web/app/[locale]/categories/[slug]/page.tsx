import { localePath } from "@repo/content";
import { countPublishedReviews, getCategoryBySlug, listPublishedArticles, listPublishedReviews } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideGrid } from "../../../../components/guide-card";
import { ReviewGrid } from "../../../../components/review-card";
import { enabledLocales, languageAlternates, messagesFor, pageLocale } from "../../../../lib/i18n";
import { absoluteUrl } from "../../../../lib/site";

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const db = getDb();
  const category = await getCategoryBySlug(db, slug, locale);
  if (!category) return { title: t.category.notFound };
  // hreflang only between locales where the category has reviews; empty category pages stay out of the index.
  const path = `/categories/${category.slug}`;
  const counts = await Promise.all(
    (await enabledLocales()).map(
      async (l) => [l, await countPublishedReviews(db, { categorySlug: slug, locale: l })] as const,
    ),
  );
  const withReviews = counts.filter(([, n]) => n > 0).map(([l]) => l);
  return {
    title: t.category.title(category.name),
    description: category.description ?? t.category.fallbackDescription(category.name),
    alternates: {
      canonical: absoluteUrl(localePath(locale, path)),
      languages: languageAlternates(Object.fromEntries(withReviews.map((l) => [l, localePath(l, path)]))),
    },
    ...(withReviews.includes(locale) ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const db = getDb();
  const category = await getCategoryBySlug(db, slug, locale);
  if (!category) notFound();
  const [reviews, guides] = await Promise.all([
    listPublishedReviews(db, { categorySlug: slug, limit: 100, locale }),
    listPublishedArticles(db, {
      categorySlug: slug,
      types: ["best_of", "comparison", "alternatives"],
      limit: 24,
      locale,
    }),
  ]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <nav aria-label={t.nav.breadcrumb} className="text-sm text-muted">
        <Link href={localePath(locale, "/")} className="hover:underline">
          {t.nav.home}
        </Link>{" "}
        / {category.name}
      </nav>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{t.category.title(category.name)}</h1>
      {category.description ? <p className="mt-2 max-w-2xl text-muted">{category.description}</p> : null}
      {guides.length ? (
        <section aria-labelledby="guides-heading" className="mt-8">
          <h2 id="guides-heading" className="text-xl font-semibold">
            {t.category.guides}
          </h2>
          <div className="mt-4">
            <GuideGrid guides={guides} t={t} />
          </div>
        </section>
      ) : null}
      <div className="mt-8">
        {reviews.length ? <ReviewGrid reviews={reviews} t={t} /> : <p className="text-muted">{t.category.empty}</p>}
      </div>
    </div>
  );
}
