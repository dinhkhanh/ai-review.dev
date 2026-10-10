import { getPublishedArticleBySlug, getSetting } from "@repo/core";
import { getDb } from "@repo/db";
import { ArticleRenderer, tableOfContents } from "@repo/ui/article";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { directLinksFor } from "../lib/golinks";
import { articleAlternates, messagesFor, pageLocale } from "../lib/i18n";
import { assetUrl } from "../lib/media";
import { articleUrlPath, jsonLdScript, listJsonLd, reviewPath, toRenderModel } from "../lib/render";
import { absoluteUrl } from "../lib/site";
import { ArticleHeader, ArticleToc } from "./article-chrome";

/** Comparisons, alternatives lists and best-of lists (FR-CON-8, FR-WEB-1). */
export type GuideType = "comparison" | "alternatives" | "best_of";

const load = cache(async (type: GuideType, slug: string, locale: string) =>
  getPublishedArticleBySlug(getDb(), slug, type, locale),
);

export async function guideMetadata(type: GuideType, slug: string): Promise<Metadata> {
  const locale = await pageLocale();
  const data = await load(type, slug, locale);
  if (!data) return { title: messagesFor(locale).article.guideNotFound, robots: { index: false } };
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

export async function GuidePage({ type, slug }: { type: GuideType; slug: string }) {
  const locale = await pageLocale();
  const data = await load(type, slug, locale);
  if (!data) notFound();
  const t = messagesFor(locale);
  const db = getDb();
  const live = data.listProducts.filter((p) => p.status !== "discontinued");
  const [settingDisclosure, ...links] = await Promise.all([
    getSetting(db, "editorial.aiDisclosure"),
    ...live.map((p) => directLinksFor(p.goSlug, data.article.slug)),
  ]);
  const model = toRenderModel(data, { directLinks: Object.assign({}, ...links) });
  // Products that are gone keep their section but lose their CTA (FR-MNT-4).
  const gone = new Set(data.listProducts.filter((p) => p.status === "discontinued").map((p) => p.goSlug));
  model.blocks = model.blocks.filter((b) => !(b.type === "cta" && gone.has(b.goSlug)));
  const toc = tableOfContents(data.version.blocks);
  const reviewed = data.listProducts.filter((p) => p.reviewSlug);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(listJsonLd(data)) }} />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[minmax(0,720px)_1fr]">
        <article>
          <ArticleHeader
            data={data}
            current={t.types[type]}
            verified={data.article.lastVerifiedAt}
            aiDisclosure={t.article.aiDisclosure ?? settingDisclosure ?? null}
          />
          <div className="mt-6">
            <ArticleRenderer model={model} />
          </div>
        </article>
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-6">
            {reviewed.length ? (
              <div className="rounded-lg border border-border p-5 text-sm">
                <p className="font-semibold">{t.article.fullReviews}</p>
                <ul className="mt-2 space-y-1.5">
                  {reviewed.map((p) => (
                    <li key={p.id}>
                      <Link href={reviewPath(p.reviewSlug!, locale)} className="hover:underline">
                        {p.name}
                      </Link>
                      {p.score != null ? (
                        <span className="text-muted">
                          {" "}
                          · {p.score.toLocaleString(t.intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/10
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ArticleToc toc={toc} />
          </div>
        </aside>
      </div>
    </>
  );
}
