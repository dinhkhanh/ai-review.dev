import { articlePath, buildListStructuredData, buildReviewStructuredData } from "@repo/content";
import type { ArticleRenderData } from "@repo/core";
import type { RenderModel } from "@repo/ui/article";
import { assetUrl, toRenderMedia } from "./media";
import { absoluteUrl, SITE } from "./site";

/** Go-link with placement and the article slug for SubID attribution (FR-AFF-6, FR-WEB-5). */
export function goHref(articleSlug: string) {
  return (slug: string, placement: string) =>
    `/go/${encodeURIComponent(slug)}?p=${encodeURIComponent(placement)}&a=${encodeURIComponent(articleSlug)}`;
}

export function toRenderModel(
  data: ArticleRenderData,
  opts: { directLinks?: Record<string, string> } = {},
): RenderModel {
  const media = Object.fromEntries(data.media.map((m) => [m.id, toRenderMedia(m)]));
  const products: RenderModel["products"] = {};
  if (data.product) products[data.product.id] = { name: data.product.name, href: null };
  for (const p of data.listProducts)
    products[p.id] = { name: p.name, href: p.reviewSlug ? `/reviews/${p.reviewSlug}` : null };
  for (const c of data.competitors)
    products[c.productId] = { name: c.name, href: c.reviewSlug ? `/reviews/${c.reviewSlug}` : null };
  // A discontinued product's CTAs would lead to a dead site (FR-MNT-4); the banner offers alternatives.
  const discontinued = data.product?.status === "discontinued";
  return {
    blocks: discontinued ? data.version.blocks.filter((b) => b.type !== "cta") : data.version.blocks,
    media,
    sources: data.sources,
    products,
    goHref: goHref(data.article.slug),
    directLinks: opts.directLinks,
    reportHref: `/report?article=${encodeURIComponent(data.article.slug)}`,
    disclosureHref: "/affiliate-disclosure",
  };
}

export function reviewJsonLd(data: ArticleRenderData) {
  const url = absoluteUrl(`/reviews/${data.article.slug}`);
  const og = data.media.find((m) => m.id === data.version.seo?.ogImageAssetId);
  const logo = data.media.find((m) => m.id === data.product?.logoAssetId);
  return buildReviewStructuredData({
    siteUrl: SITE.url,
    siteName: SITE.name,
    url,
    title: data.version.seo?.title ?? data.article.title,
    description: data.version.seo?.metaDescription ?? "",
    publishedAt: data.article.publishedAt,
    updatedAt: data.article.updatedAt,
    imageUrl: assetUrl(og),
    author: { name: data.author?.name ?? "Editor", url: absoluteUrl(`/authors/${data.author?.slug ?? ""}`) },
    product: {
      name: data.product?.name ?? data.article.title,
      websiteUrl: data.product?.websiteUrl ?? SITE.url,
      category: data.category?.name ?? null,
      logoUrl: assetUrl(logo),
    },
    score: data.version.overallScore,
    factSheet: data.factSheet,
    blocks: data.version.blocks,
    breadcrumbs: [
      { name: "Home", url: SITE.url },
      ...(data.category ? [{ name: data.category.name, url: absoluteUrl(`/categories/${data.category.slug}`) }] : []),
      { name: data.article.title, url },
    ],
  });
}

/** Serialises JSON-LD safely inside a <script> tag. */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** JSON-LD for comparisons, alternatives and best-of lists: Article + ItemList (FR-CON-9). */
export function listJsonLd(data: ArticleRenderData) {
  const path = articlePath(data.article.type, data.article.slug);
  const url = absoluteUrl(path);
  const og = data.media.find((m) => m.id === data.version.seo?.ogImageAssetId);
  return buildListStructuredData({
    siteUrl: SITE.url,
    siteName: SITE.name,
    url,
    title: data.version.seo?.title ?? data.article.title,
    description: data.version.seo?.metaDescription ?? "",
    publishedAt: data.article.publishedAt,
    updatedAt: data.article.updatedAt,
    imageUrl: assetUrl(og),
    author: { name: data.author?.name ?? "Editor", url: absoluteUrl(`/authors/${data.author?.slug ?? ""}`) },
    items: data.listProducts.map((p) => ({
      name: p.name,
      url: p.reviewSlug ? absoluteUrl(`/reviews/${p.reviewSlug}`) : p.websiteUrl,
    })),
    blocks: data.version.blocks,
    breadcrumbs: [
      { name: "Home", url: SITE.url },
      ...(data.category ? [{ name: data.category.name, url: absoluteUrl(`/categories/${data.category.slug}`) }] : []),
      { name: data.article.title, url },
    ],
  });
}
