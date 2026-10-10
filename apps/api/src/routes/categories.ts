import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { CategoryListSchema } from "@repo/contracts";
import { listCategories } from "@repo/core";
import type { AppEnv } from "../create-app";

const route = createRoute({
  method: "get",
  path: "/categories",
  tags: ["catalog"],
  summary: "List review categories",
  responses: {
    200: {
      content: { "application/json": { schema: CategoryListSchema } },
      description: "All categories in display order",
    },
  },
});

export const categoriesRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const data = await listCategories(c.get("db"));
  // Edge-cacheable; purged by tag when categories change (FR-API-2).
  c.header("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  c.header("Cache-Tag", "categories");
  return c.json({ data }, 200);
});
