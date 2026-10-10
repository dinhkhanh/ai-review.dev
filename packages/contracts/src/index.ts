import { z } from "@hono/zod-openapi";

/**
 * Public API v1 contracts (FR-API-1). These schemas generate the OpenAPI document and are the
 * only thing the mobile app depends on (NFR-13). Additive changes only within /v1.
 */

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string().openapi({ example: "Category not found" }),
    }),
  })
  .openapi("ErrorResponse");

export const HealthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    db: z.enum(["ok", "error"]),
    version: z.string(),
    time: z.iso.datetime(),
  })
  .openapi("HealthResponse");

export const CategorySchema = z
  .object({
    id: z.uuid(),
    slug: z.string().openapi({ example: "ai-tools" }),
    name: z.string().openapi({ example: "AI Tools" }),
    description: z.string().nullable(),
  })
  .openapi("Category");

export const CategoryListSchema = z.object({ data: z.array(CategorySchema) }).openapi("CategoryList");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type CategoryList = z.infer<typeof CategoryListSchema>;

export const API_VERSION = "1.0.0";
