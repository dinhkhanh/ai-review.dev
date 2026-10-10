import { getAuthorBySlug, listPublishedReviews } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewGrid } from "../../../components/review-card";
import { absoluteUrl, SITE } from "../../../lib/site";

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const author = await getAuthorBySlug(getDb(), slug);
  if (!author) return { title: "Author not found" };
  return {
    title: author.name,
    description: author.bio ?? `${author.name} at ${SITE.name}`,
    alternates: { canonical: absoluteUrl(`/authors/${slug}`) },
  };
}

/** Author page (D-8): a real editor-in-chief with a bio builds trust and E-E-A-T. */
export default async function AuthorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const author = await getAuthorBySlug(db, slug);
  if (!author) notFound();
  const reviews = await listPublishedReviews(db, { authorId: author.id, limit: 100 });
  const person = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: author.name,
    url: absoluteUrl(`/authors/${author.slug}`),
    ...(author.bio ? { description: author.bio } : {}),
    sameAs: Object.values(author.links ?? {}),
    worksFor: { "@type": "Organization", name: SITE.name, url: SITE.url },
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(person).replace(/</g, "\\u003c") }}
      />
      <h1 className="text-3xl font-bold tracking-tight">{author.name}</h1>
      {author.bio ? <p className="mt-3 max-w-2xl leading-7 text-muted">{author.bio}</p> : null}
      {Object.keys(author.links ?? {}).length ? (
        <ul className="mt-3 flex gap-4 text-sm">
          {Object.entries(author.links).map(([label, href]) => (
            <li key={label}>
              <a href={href} rel="me noopener" className="text-brand underline">
                {label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <h2 className="mt-10 text-xl font-semibold">Reviews</h2>
      <div className="mt-6">
        {reviews.length ? <ReviewGrid reviews={reviews} /> : <p className="text-muted">No reviews yet.</p>}
      </div>
    </div>
  );
}
