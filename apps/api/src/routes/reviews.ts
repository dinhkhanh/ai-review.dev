import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  LocaleQuerySchema,
  ReviewDetailSchema,
  ReviewListSchema,
  type Alternate,
  type ReviewSummary,
} from "@repo/contracts";
import { isContentLocale } from "@repo/content";
import {
  countPublishedReviews,
  getArticleTranslations,
  getMediaAssets,
  getPublishedArticleBySlug,
  getSetting,
  listPublishedReviews,
  publicVideo,
  publishedVideosForArticle,
  searchPublishedReviews,
  type ArticleTranslation,
  type ReviewCard,
} from "@repo/core";
import type { Database } from "@repo/db";
import type { AppEnv } from "../create-app";
import { articleWebUrl, cacheHeaders, iso, toImage, webUrl } from "../mappers";

/** Live versions of an article in other locales, for `alternates` (hreflang). */
export function alternatesFor(translations: ArticleTranslation[], current: string): Alternate[] {
  return translations.flatMap((t) =>
    t.locale !== current && isContentLocale(t.locale)
      ? [{ locale: t.locale, slug: t.slug, url: articleWebUrl(t.type, t.slug, t.locale) }]
      : [],
  );
}

export async function toSummaries(db: Database, cards: ReviewCard[]): Promise<ReviewSummary[]> {
  const assets = await getMediaAssets(
    db,
    cards.flatMap((c) => [c.ogImageAssetId, c.logoAssetId].filter((x): x is string => !!x)),
  );
  const byId = new Map(assets.map((a) => [a.id, a]));
  return cards.map((c) => ({
    slug: c.slug,
    locale: isContentLocale(c.locale) ? c.locale : "en",
    title: c.title,
    description: c.metaDescription,
    score: c.overallScore,
    publishedAt: iso(c.publishedAt),
    updatedAt: c.updatedAt.toISOString(),
    lastVerifiedAt: iso(c.lastVerifiedAt),
    product: { slug: c.productSlug, name: c.productName, tagline: c.productTagline },
    category: c.categorySlug && c.categoryName ? { slug: c.categorySlug, name: c.categoryName } : null,
    image: toImage(c.ogImageAssetId ? byId.get(c.ogImageAssetId) : null),
    logo: toImage(c.logoAssetId ? byId.get(c.logoAssetId) : null),
  }));
}

const listRoute = createRoute({
  method: "get",
  path: "/reviews",
  tags: ["reviews"],
  summary: "List or search published reviews",
  request: {
    query: z.object({
      category: z.string().optional().openapi({ example: "ai-tools" }),
      q: z.string().max(100).optional().openapi({ description: "Search product name or title" }),
      limit: z.coerce.number().int().min(1).max(100).default(24),
      offset: z.coerce.number().int().min(0).default(0),
      locale: LocaleQuerySchema,
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: ReviewListSchema } }, description: "Reviews, newest first" },
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/reviews/{slug}",
  tags: ["reviews"],
  summary: "Get a published review with its content blocks",
  request: {
    params: z.object({ slug: z.string().openapi({ example: "notion-review" }) }),
    query: z.object({ locale: LocaleQuerySchema }),
  },
  responses: {
    200: { content: { "application/json": { schema: ReviewDetailSchema } }, description: "The review" },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
  },
});

export const reviewsRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listRoute, async (c) => {
    const { category, q, limit, offset, locale } = c.req.valid("query");
    const db = c.get("db");
    const cards = q
      ? await searchPublishedReviews(db, q, limit, locale)
      : await listPublishedReviews(db, { categorySlug: category, limit, offset, locale });
    const total = q ? null : await countPublishedReviews(db, { categorySlug: category, locale });
    cacheHeaders(c, ["reviews", ...(category ? [`category:${category}`] : [])]);
    return c.json({ data: await toSummaries(db, cards), pagination: { limit, offset, total } }, 200);
  })
  .openapi(detailRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const { locale } = c.req.valid("query");
    const db = c.get("db");
    const data = await getPublishedArticleBySlug(db, slug, "review", locale);
    if (!data || !data.product) return c.json({ error: { code: "not_found", message: "Review not found" } }, 404);
    const web = webUrl();
    const url = articleWebUrl("review", data.article.slug, locale);
    const og = data.media.find((m) => m.id === data.version.seo?.ogImageAssetId);
    const logo = data.media.find((m) => m.id === data.product?.logoAssetId);
    const videos = (await publishedVideosForArticle(db, data.article.id)).map(publicVideo);
    cacheHeaders(c, [`article:${slug}`, "reviews"]);
    return c.json(
      {
        slug: data.article.slug,
        locale,
        alternates: alternatesFor(await getArticleTranslations(db, data.article.id), locale),
        title: data.article.title,
        seo: {
          title: data.version.seo?.title ?? data.article.title,
          description: data.version.seo?.metaDescription ?? null,
          canonicalUrl: url,
        },
        score: data.version.overallScore,
        publishedAt: iso(data.article.publishedAt),
        updatedAt: data.article.updatedAt.toISOString(),
        lastVerifiedAt: iso(data.article.lastVerifiedAt),
        aiDisclosure: (await getSetting(db, "editorial.aiDisclosure")) ?? null,
        author: data.author ? { slug: data.author.slug, name: data.author.name } : null,
        product: {
          slug: data.product.slug,
          name: data.product.name,
          tagline: data.product.tagline,
          websiteUrl: data.product.websiteUrl,
          logo: toImage(logo),
        },
        category: data.category ? { slug: data.category.slug, name: data.category.name } : null,
        blocks: data.version.blocks,
        media: Object.fromEntries(
          data.media
            .filter((m) => m.id !== og?.id)
            .flatMap((m) => {
              const img = toImage(m);
              return img ? [[m.id, img]] : [];
            }),
        ),
        sources: data.sources.map((s) => ({
          id: s.id,
          url: s.url,
          title: s.title,
          kind: s.kind,
          fetchedAt: s.fetchedAt.toISOString(),
        })),
        links: { go: data.goSlug, goBaseUrl: `${web}/go`, web: url },
        competitors: data.competitors.map((x) => ({ name: x.name, reviewSlug: x.reviewSlug, note: x.note })),
        videos: videos.map((v) => ({ ...v, uploadedAt: iso(v.uploadedAt) })),
      },
      200,
    );
  });
