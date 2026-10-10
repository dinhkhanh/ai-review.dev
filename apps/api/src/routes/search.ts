import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ArticleTypeSchema, LocaleQuerySchema, SearchResultListSchema } from "@repo/contracts";
import { searchSite } from "@repo/core";
import type { AppEnv } from "../create-app";
import { articleWebUrl, cacheHeaders } from "../mappers";
import { toSummaries } from "./reviews";

const searchRoute = createRoute({
  method: "get",
  path: "/search",
  tags: ["search"],
  summary: "Full-text search across published reviews, comparisons and lists",
  request: {
    query: z.object({
      q: z.string().trim().min(1).max(200).openapi({ example: "website analytics" }),
      category: z.string().optional().openapi({ example: "ai-tools" }),
      type: ArticleTypeSchema.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      offset: z.coerce.number().int().min(0).default(0),
      locale: LocaleQuerySchema,
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: SearchResultListSchema } }, description: "Best matches first" },
  },
});

/** Site search (FR-WEB-7) for the mobile app and web clients. */
export const searchRoutes = new OpenAPIHono<AppEnv>().openapi(searchRoute, async (c) => {
  const { q, category, type, limit, offset, locale } = c.req.valid("query");
  const db = c.get("db");
  const hits = await searchSite(db, { q, categorySlug: category, type, limit, offset, locale });
  const summaries = await toSummaries(
    db,
    hits.map((h) => ({ ...h, locale })),
  );
  cacheHeaders(c, ["reviews", "search"], 120);
  return c.json(
    {
      data: hits.map((h, i) => ({ ...summaries[i]!, type: h.type, url: articleWebUrl(h.type, h.slug, locale) })),
      pagination: { limit, offset, total: null },
    },
    200,
  );
});
