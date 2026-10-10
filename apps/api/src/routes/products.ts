import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ErrorResponseSchema, LocaleQuerySchema, ProductDetailSchema, ProductListSchema } from "@repo/contracts";
import { countReviewedProducts, getMediaAssets, getReviewedProductBySlug, listReviewedProducts } from "@repo/core";
import type { AppEnv } from "../create-app";
import { cacheHeaders, iso, toImage } from "../mappers";

const listRoute = createRoute({
  method: "get",
  path: "/products",
  tags: ["products"],
  summary: "List products that have a published review",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
      locale: LocaleQuerySchema,
    }),
  },
  responses: { 200: { content: { "application/json": { schema: ProductListSchema } }, description: "Products A–Z" } },
});

const detailRoute = createRoute({
  method: "get",
  path: "/products/{slug}",
  tags: ["products"],
  summary: "Get a reviewed product with verified pricing",
  request: {
    params: z.object({ slug: z.string().openapi({ example: "notion" }) }),
    query: z.object({ locale: LocaleQuerySchema }),
  },
  responses: {
    200: { content: { "application/json": { schema: ProductDetailSchema } }, description: "The product" },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
  },
});

export const productsRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listRoute, async (c) => {
    const { limit, offset, locale } = c.req.valid("query");
    const db = c.get("db");
    const [rows, total] = await Promise.all([
      listReviewedProducts(db, { limit, offset, locale }),
      countReviewedProducts(db, { locale }),
    ]);
    const logos = new Map(
      (
        await getMediaAssets(
          db,
          rows.flatMap((r) => (r.logoAssetId ? [r.logoAssetId] : [])),
        )
      ).map((a) => [a.id, a]),
    );
    cacheHeaders(c, ["products"]);
    return c.json(
      {
        data: rows.map((r) => ({
          slug: r.slug,
          name: r.name,
          tagline: r.tagline,
          websiteUrl: r.websiteUrl,
          category: r.categorySlug && r.categoryName ? { slug: r.categorySlug, name: r.categoryName } : null,
          reviewSlug: r.reviewSlug,
          score: r.score,
          logo: toImage(r.logoAssetId ? logos.get(r.logoAssetId) : null),
        })),
        pagination: { limit, offset, total },
      },
      200,
    );
  })
  .openapi(detailRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const { locale } = c.req.valid("query");
    const db = c.get("db");
    const p = await getReviewedProductBySlug(db, slug, locale);
    if (!p) return c.json({ error: { code: "not_found", message: "Product not found" } }, 404);
    const [logo] = p.logoAssetId ? await getMediaAssets(db, [p.logoAssetId]) : [];
    const tiers = p.factSheet?.pricing?.tiers.value ?? [];
    cacheHeaders(c, [`product:${slug}`, "products"]);
    return c.json(
      {
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        websiteUrl: p.websiteUrl,
        category: p.categorySlug && p.categoryName ? { slug: p.categorySlug, name: p.categoryName } : null,
        reviewSlug: p.reviewSlug,
        score: p.score,
        logo: toImage(logo),
        pricing: tiers.length
          ? {
              tiers: tiers.map((t) => ({
                name: t.name,
                price: t.price,
                currency: t.currency,
                period: t.period,
                highlights: t.highlights,
              })),
              verifiedAt: iso(p.factSheetAt),
            }
          : null,
        goSlug: p.goSlug,
      },
      200,
    );
  });
