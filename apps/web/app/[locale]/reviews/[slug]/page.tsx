import { getPublishedArticleBySlug, getSetting } from "@repo/core";
import { getDb } from "@repo/db";
import { ArticleRenderer, StickyCta, tableOfContents } from "@repo/ui/article";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArticleHeader, ArticleToc, SidebarCta } from "../../../../components/article-chrome";
import { DiscontinuedBanner } from "../../../../components/discontinued-banner";
import { ReviewExtras } from "../../../../components/review-extras";
import { ReviewVideos } from "../../../../components/review-videos";
import { directLinksFor } from "../../../../lib/golinks";
import { articleAlternates, messagesFor, pageLocale } from "../../../../lib/i18n";
import { assetUrl } from "../../../../lib/media";
import { articleUrlPath, goHref, jsonLdScript, reviewJsonLd, toRenderModel } from "../../../../lib/render";
import { absoluteUrl } from "../../../../lib/site";

// Static generation on first request, then ISR; publishing revalidates on demand (FR-WEB-2).
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

const load = cache(async (slug: string, locale: string) => getPublishedArticleBySlug(getDb(), slug, "review", locale));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await pageLocale();
  const data = await load(slug, locale);
  if (!data) return { title: messagesFor(locale).article.notFound, robots: { index: false } };
  const og = data.media.find((m) => m.id === data.version.seo?.ogImageAssetId);
  const ogUrl = assetUrl(og);
  const title = data.version.seo?.title ?? data.article.title;
  const description = data.version.seo?.metaDescription;
  const path = articleUrlPath(data);
  return {
    title: { absolute: title },
    description,
    alternates: await articleAlternates(data.article.id, path),
    openGraph: {
      type: "article",
      title,
      description,
      url: absoluteUrl(path),
      locale: messagesFor(locale).intl.replace("-", "_"),
      publishedTime: data.article.publishedAt?.toISOString(),
      modifiedTime: data.article.updatedAt.toISOString(),
      ...(ogUrl ? { images: [{ url: ogUrl, width: 1200, height: 630, alt: og?.alt ?? title }] } : {}),
    },
    twitter: { card: "summary_large_image", title, description, ...(ogUrl ? { images: [ogUrl] } : {}) },
  };
}

export default async function ReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await pageLocale();
  const data = await load(slug, locale);
  if (!data) notFound();
  const t = messagesFor(locale);
  const db = getDb();
  const [settingDisclosure, directLinks] = await Promise.all([
    getSetting(db, "editorial.aiDisclosure"),
    directLinksFor(data.goSlug, data.article.slug),
  ]);
  const model = toRenderModel(data, { directLinks });
  const toc = tableOfContents(data.version.blocks);
  const cta = data.product?.status === "discontinued" ? undefined : data.version.blocks.find((b) => b.type === "cta");
  const stickyHref = data.goSlug
    ? (directLinks[data.goSlug] ?? goHref(data.article.slug)(data.goSlug, "sticky_mobile"))
    : null;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(reviewJsonLd(data)) }} />
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-8 lg:grid-cols-[minmax(0,720px)_1fr]">
        <article>
          <ArticleHeader
            data={data}
            current={data.product?.name ?? data.article.title}
            verified={data.article.lastVerifiedAt ?? data.factSheetUpdatedAt}
            aiDisclosure={t.article.aiDisclosure ?? settingDisclosure ?? null}
          />
          <DiscontinuedBanner data={data} />
          <div className="mt-6">
            <ArticleRenderer model={model} />
          </div>
          <ReviewVideos articleId={data.article.id} title={data.article.title} />
          <ReviewExtras
            articleSlug={data.article.slug}
            path={articleUrlPath(data)}
            title={data.article.title}
            productId={data.product?.id ?? null}
            productName={data.product?.name ?? null}
            goSlug={data.goSlug}
          />
        </article>
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-6">
            {typeof data.version.overallScore === "number" && cta?.type === "cta" && data.goSlug ? (
              <SidebarCta
                score={data.version.overallScore}
                productName={data.product?.name ?? null}
                href={directLinks[data.goSlug] ?? goHref(data.article.slug)(data.goSlug, "hero")}
                label={cta.label}
              />
            ) : null}
            <ArticleToc toc={toc} />
          </div>
        </aside>
      </div>
      {stickyHref && cta?.type === "cta" ? (
        <StickyCta
          href={stickyHref}
          label={cta.label}
          score={data.version.overallScore}
          labels={{ ...t.render, adLabel: t.ads.label, affiliateMarker: t.ads.marker }}
        />
      ) : null}
    </>
  );
}
