import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { DealListSchema } from "@repo/contracts";
import { getMediaAssets, listActiveDeals } from "@repo/core";
import type { AppEnv } from "../create-app";
import { cacheHeaders, iso, toImage, webUrl } from "../mappers";

const listRoute = createRoute({
  method: "get",
  path: "/deals",
  tags: ["deals"],
  summary: "Active deals, promo codes and trials for reviewed products",
  request: { query: z.object({ category: z.string().optional().openapi({ example: "ai-tools" }) }) },
  responses: {
    200: { content: { "application/json": { schema: DealListSchema } }, description: "Active deals by category" },
  },
});

/** Deals feed (FR-WEB-8). CTAs must use the go-link with placement `deals`. */
export const dealsRoutes = new OpenAPIHono<AppEnv>().openapi(listRoute, async (c) => {
  const { category } = c.req.valid("query");
  const db = c.get("db");
  const rows = await listActiveDeals(db, { categorySlug: category });
  const logos = new Map(
    (
      await getMediaAssets(
        db,
        rows.flatMap((r) => (r.logoAssetId ? [r.logoAssetId] : [])),
      )
    ).map((a) => [a.id, a]),
  );
  const web = webUrl();
  cacheHeaders(c, ["deals", ...(category ? [`category:${category}`] : [])]);
  return c.json(
    {
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        code: r.code,
        discountText: r.discountText,
        endsAt: iso(r.endsAt),
        product: {
          slug: r.productSlug,
          name: r.productName,
          logo: toImage(r.logoAssetId ? logos.get(r.logoAssetId) : null),
        },
        category: r.categorySlug && r.categoryName ? { slug: r.categorySlug, name: r.categoryName } : null,
        reviewSlug: r.reviewSlug,
        links: { go: r.goSlug, web: `${web}/reviews/${r.reviewSlug}` },
      })),
    },
    200,
  );
});
