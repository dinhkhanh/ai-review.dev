import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { CategoryDetailSchema, CategoryListSchema, ErrorResponseSchema, LocaleQuerySchema } from "@repo/contracts";
import { getCategoryBySlug, listCategoriesWithCounts, listPublishedReviews } from "@repo/core";
import type { AppEnv } from "../create-app";
import { cacheHeaders } from "../mappers";
import { toSummaries } from "./reviews";

const route = createRoute({
  method: "get",
  path: "/categories",
  tags: ["catalog"],
  summary: "List review categories",
  request: { query: z.object({ locale: LocaleQuerySchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: CategoryListSchema } },
      description: "All categories in display order",
    },
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/categories/{slug}",
  tags: ["catalog"],
  summary: "Get a category with its published reviews",
  request: {
    params: z.object({ slug: z.string().openapi({ example: "ai-tools" }) }),
    query: z.object({ locale: LocaleQuerySchema }),
  },
  responses: {
    200: { content: { "application/json": { schema: CategoryDetailSchema } }, description: "The category" },
    404: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Not found" },
  },
});

export const categoriesRoutes = new OpenAPIHono<AppEnv>()
  .openapi(route, async (c) => {
    const { locale } = c.req.valid("query");
    const data = (await listCategoriesWithCounts(c.get("db"), { locale })).map((x) => ({
      id: x.id,
      slug: x.slug,
      name: x.name,
      description: x.description,
    }));
    // Edge-cacheable; purged by tag when categories change (FR-API-2).
    cacheHeaders(c, ["categories"]);
    return c.json({ data }, 200);
  })
  .openapi(detailRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const { locale } = c.req.valid("query");
    const db = c.get("db");
    const category = await getCategoryBySlug(db, slug, locale);
    if (!category) return c.json({ error: { code: "not_found", message: "Category not found" } }, 404);
    const reviews = await toSummaries(db, await listPublishedReviews(db, { categorySlug: slug, limit: 100, locale }));
    cacheHeaders(c, [`category:${slug}`]);
    return c.json(
      { id: category.id, slug: category.slug, name: category.name, description: category.description, reviews },
      200,
    );
  });
