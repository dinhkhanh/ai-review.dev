import { getPublishedArticleBySlug, getSetting } from "@repo/core";
import { getDb } from "@repo/db";
import { ArticleRenderer, ScoreBadge, StickyCta, tableOfContents } from "@repo/ui/article";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ReviewExtras } from "../../../components/review-extras";
import { DiscontinuedBanner } from "../../../components/discontinued-banner";
import { ReviewVideos } from "../../../components/review-videos";
import { directLinksFor } from "../../../lib/golinks";
import { assetUrl } from "../../../lib/media";
import { goHref, jsonLdScript, reviewJsonLd, toRenderModel } from "../../../lib/render";
import { absoluteUrl } from "../../../lib/site";

// Static generation on first request, then ISR; publishing revalidates on demand (FR-WEB-2).
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

const load = cache(async (slug: string) => getPublishedArticleBySlug(getDb(), slug));

const dateFmt = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: "Review not found", robots: { index: false } };
  const og = data.media.find((m) => m.id === data.version.seo?.ogImageAssetId);
  const ogUrl = assetUrl(og);
  const title = data.version.seo?.title ?? data.article.title;
  const description = data.version.seo?.metaDescription;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: absoluteUrl(`/reviews/${data.article.slug}`) },
    openGraph: {
      type: "article",
      title,
      description,
      url: absoluteUrl(`/reviews/${data.article.slug}`),
      publishedTime: data.article.publishedAt?.toISOString(),
      modifiedTime: data.article.updatedAt.toISOString(),
      ...(ogUrl ? { images: [{ url: ogUrl, width: 1200, height: 630, alt: og?.alt ?? title }] } : {}),
    },
    twitter: { card: "summary_large_image", title, description, ...(ogUrl ? { images: [ogUrl] } : {}) },
  };
}

export default async function ReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const db = getDb();
  const [aiDisclosure, directLinks] = await Promise.all([
    getSetting(db, "editorial.aiDisclosure"),
    directLinksFor(data.goSlug, data.article.slug),
  ]);
  const model = toRenderModel(data, { directLinks });
  const toc = tableOfContents(data.version.blocks);
  const cta = data.product?.status === "discontinued" ? undefined : data.version.blocks.find((b) => b.type === "cta");
  const stickyHref = data.goSlug
    ? (directLinks[data.goSlug] ?? goHref(data.article.slug)(data.goSlug, "sticky_mobile"))
    : null;
  const verified = data.article.lastVerifiedAt ?? data.factSheetUpdatedAt;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(reviewJsonLd(data)) }} />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[minmax(0,720px)_1fr]">
        <article>
          <nav aria-label="Breadcrumb" className="text-sm text-muted">
            <ol className="flex flex-wrap gap-1.5">
              <li>
                <Link href="/" className="hover:underline">
                  Home
                </Link>{" "}
                /
              </li>
              {data.category ? (
                <li>
                  <Link href={`/categories/${data.category.slug}`} className="hover:underline">
                    {data.category.name}
                  </Link>{" "}
                  /
                </li>
              ) : null}
              <li aria-current="page">{data.product?.name ?? data.article.title}</li>
            </ol>
          </nav>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{data.article.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {data.author ? (
              <span>
                By{" "}
                <Link href={`/authors/${data.author.slug}`} className="font-medium text-text hover:underline">
                  {data.author.name}
                </Link>
              </span>
            ) : null}
            <span>Updated {dateFmt(data.article.updatedAt)}</span>
            {verified ? <span>Facts verified {dateFmt(verified)}</span> : null}
          </div>
          {aiDisclosure ? (
            <p className="mt-2 text-xs text-muted">
              {aiDisclosure}{" "}
              <Link href="/editorial-policy" className="underline">
                Our process
              </Link>
            </p>
          ) : null}
          <DiscontinuedBanner data={data} />
          <div className="mt-6">
            <ArticleRenderer model={model} />
          </div>
          <ReviewVideos articleId={data.article.id} title={data.article.title} />
          <ReviewExtras
            articleSlug={data.article.slug}
            title={data.article.title}
            productId={data.product?.id ?? null}
            productName={data.product?.name ?? null}
            goSlug={data.goSlug}
          />
        </article>
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-6">
            {typeof data.version.overallScore === "number" && cta?.type === "cta" && data.goSlug ? (
              <div className="rounded-lg border border-border p-5">
                <div className="flex items-center gap-3">
                  <ScoreBadge score={data.version.overallScore} />
                  <div>
                    <p className="font-semibold">{data.product?.name}</p>
                    <p className="text-xs text-muted">Our score out of 10</p>
                  </div>
                </div>
                <a
                  href={directLinks[data.goSlug] ?? goHref(data.article.slug)(data.goSlug, "hero")}
                  rel="sponsored nofollow noopener"
                  target="_blank"
                  className="mt-4 flex h-11 items-center justify-center rounded-md bg-brand text-sm font-semibold text-brand-fg hover:opacity-90"
                >
                  {cta.label}
                </a>
              </div>
            ) : null}
            {toc.length > 2 ? (
              <nav aria-label="On this page" className="text-sm">
                <p className="font-semibold">On this page</p>
                <ol className="mt-2 space-y-1.5 text-muted">
                  {toc.map((t) => (
                    <li key={t.id}>
                      <a href={`#${t.id}`} className="hover:text-text hover:underline">
                        {t.text}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}
          </div>
        </aside>
      </div>
      {stickyHref && cta?.type === "cta" ? (
        <StickyCta href={stickyHref} label={cta.label} score={data.version.overallScore} />
      ) : null}
    </>
  );
}
