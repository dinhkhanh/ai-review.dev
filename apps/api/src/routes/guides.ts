import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ErrorResponseSchema, GuideDetailSchema, GuideListSchema, GuideTypeSchema } from "@repo/contracts";
import { articlePath } from "@repo/content";
import { getMediaAssets, getPublishedArticleBySlug, getSetting, listPublishedArticles } from "@repo/core";
import type { AppEnv } from "../create-app";
import { cacheHeaders, iso, toImage, webUrl } from "../mappers";

const listRoute = createRoute({
  method: "get",
  path: "/guides",
  tags: ["guides"],
  summary: "List published comparisons, alternatives lists and best-of lists",
  request: {
    query: z.object({
      type: GuideTypeSchema.optional(),
      category: z.string().optional().openapi({ example: "productivity" }),
      limit: z.coerce.number().int().min(1).max(100).default(24),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: GuideListSchema } }, description: "Guides, newest first" },
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/guides/{type}/{slug}",
  tags: ["guides"],
  summary: "Get a published comparison or list with its content blocks",
  request: {
    params: z.object({ type: GuideTypeSchema, slug: z.string().openapi({ example: "notion-vs-coda" }) }),
  },
  responses: {
    200: { content: { "application/json": { schema: GuideDetailSchema } }, description: "The guide" },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
  },
});

/** Comparisons and lists for the mobile app (FR-CON-8, FR-API-1). Same block contract as reviews. */
export const guidesRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listRoute, async (c) => {
    const { type, category, limit, offset } = c.req.valid("query");
    const db = c.get("db");
    const rows = await listPublishedArticles(db, {
      types: type ? [type] : ["comparison", "alternatives", "best_of"],
      categorySlug: category,
      limit,
      offset,
    });
    const assets = await getMediaAssets(
      db,
      rows.flatMap((r) => (r.ogImageAssetId ? [r.ogImageAssetId] : [])),
    );
    const web = webUrl();
    cacheHeaders(c, ["guides", ...(category ? [`category:${category}`] : [])]);
    return c.json(
      {
        data: rows.map((r) => ({
          type: r.type as "comparison" | "alternatives" | "best_of",
          slug: r.slug,
          title: r.title,
          description: r.metaDescription,
          publishedAt: iso(r.publishedAt),
          updatedAt: r.updatedAt.toISOString(),
          lastVerifiedAt: iso(r.lastVerifiedAt),
          productCount: r.productCount,
          category: r.categorySlug && r.categoryName ? { slug: r.categorySlug, name: r.categoryName } : null,
          image: toImage(assets.find((a) => a.id === r.ogImageAssetId)),
          url: `${web}${articlePath(r.type, r.slug)}`,
        })),
        pagination: { limit, offset, total: null },
      },
      200,
    );
  })
  .openapi(detailRoute, async (c) => {
    const { type, slug } = c.req.valid("param");
    const db = c.get("db");
    const data = await getPublishedArticleBySlug(db, slug, type);
    if (!data) return c.json({ error: { code: "not_found", message: "Guide not found" } }, 404);
    const web = webUrl();
    const url = `${web}${articlePath(type, data.article.slug)}`;
    const og = data.media.find((m) => m.id === data.version.seo?.ogImageAssetId);
    cacheHeaders(c, [`article:${slug}`, "guides"]);
    return c.json(
      {
        type,
        slug: data.article.slug,
        title: data.article.title,
        seo: {
          title: data.version.seo?.title ?? data.article.title,
          description: data.version.seo?.metaDescription ?? null,
          canonicalUrl: url,
        },
        publishedAt: iso(data.article.publishedAt),
        updatedAt: data.article.updatedAt.toISOString(),
        lastVerifiedAt: iso(data.article.lastVerifiedAt),
        aiDisclosure: (await getSetting(db, "editorial.aiDisclosure")) ?? null,
        author: data.author ? { slug: data.author.slug, name: data.author.name } : null,
        category: data.category ? { slug: data.category.slug, name: data.category.name } : null,
        products: data.listProducts.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          tagline: p.tagline,
          websiteUrl: p.websiteUrl,
          reviewSlug: p.reviewSlug,
          score: p.score,
          go: p.goSlug,
          discontinued: p.status === "discontinued",
        })),
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
        links: { goBaseUrl: `${web}/go`, web: url },
      },
      200,
    );
  });
