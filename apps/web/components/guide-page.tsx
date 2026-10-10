import { ARTICLE_TYPE_LABEL, articlePath } from "@repo/content";
import { getPublishedArticleBySlug, getSetting } from "@repo/core";
import { getDb } from "@repo/db";
import { ArticleRenderer, tableOfContents } from "@repo/ui/article";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { directLinksFor } from "../lib/golinks";
import { assetUrl } from "../lib/media";
import { jsonLdScript, listJsonLd, toRenderModel } from "../lib/render";
import { absoluteUrl } from "../lib/site";

/** Comparisons, alternatives lists and best-of lists (FR-CON-8, FR-WEB-1). */
export type GuideType = "comparison" | "alternatives" | "best_of";

const load = cache(async (type: GuideType, slug: string) => getPublishedArticleBySlug(getDb(), slug, type));

const dateFmt = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export async function guideMetadata(type: GuideType, slug: string): Promise<Metadata> {
  const data = await load(type, slug);
  if (!data) return { title: "Not found", robots: { index: false } };
  const og = data.media.find((m) => m.id === data.version.seo?.ogImageAssetId);
  const ogUrl = assetUrl(og);
  const title = data.version.seo?.title ?? data.article.title;
  const description = data.version.seo?.metaDescription;
  const url = absoluteUrl(articlePath(type, data.article.slug));
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      publishedTime: data.article.publishedAt?.toISOString(),
      modifiedTime: data.article.updatedAt.toISOString(),
      ...(ogUrl ? { images: [{ url: ogUrl, width: 1200, height: 630, alt: og?.alt ?? title }] } : {}),
    },
    twitter: { card: "summary_large_image", title, description, ...(ogUrl ? { images: [ogUrl] } : {}) },
  };
}

export async function GuidePage({ type, slug }: { type: GuideType; slug: string }) {
  const data = await load(type, slug);
  if (!data) notFound();
  const db = getDb();
  const live = data.listProducts.filter((p) => p.status !== "discontinued");
  const [aiDisclosure, ...links] = await Promise.all([
    getSetting(db, "editorial.aiDisclosure"),
    ...live.map((p) => directLinksFor(p.goSlug, data.article.slug)),
  ]);
  const model = toRenderModel(data, { directLinks: Object.assign({}, ...links) });
  // Products that are gone keep their section but lose their CTA (FR-MNT-4).
  const gone = new Set(data.listProducts.filter((p) => p.status === "discontinued").map((p) => p.goSlug));
  model.blocks = model.blocks.filter((b) => !(b.type === "cta" && gone.has(b.goSlug)));
  const toc = tableOfContents(data.version.blocks);
  const verified = data.article.lastVerifiedAt;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(listJsonLd(data)) }} />
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
              <li aria-current="page">{ARTICLE_TYPE_LABEL[type]}</li>
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
          <div className="mt-6">
            <ArticleRenderer model={model} />
          </div>
        </article>
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-6">
            {data.listProducts.some((p) => p.reviewSlug) ? (
              <div className="rounded-lg border border-border p-5 text-sm">
                <p className="font-semibold">Full reviews</p>
                <ul className="mt-2 space-y-1.5">
                  {data.listProducts
                    .filter((p) => p.reviewSlug)
                    .map((p) => (
                      <li key={p.id}>
                        <Link href={`/reviews/${p.reviewSlug}`} className="hover:underline">
                          {p.name}
                        </Link>
                        {p.score != null ? <span className="text-muted"> · {p.score.toFixed(1)}/10</span> : null}
                      </li>
                    ))}
                </ul>
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
    </>
  );
}
