import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { API_VERSION, HealthResponseSchema } from "@repo/contracts";
import { sql } from "@repo/db";
import type { AppEnv } from "../create-app";

const route = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  summary: "Service health",
  responses: {
    200: { content: { "application/json": { schema: HealthResponseSchema } }, description: "Service is up" },
    503: { content: { "application/json": { schema: HealthResponseSchema } }, description: "Database unreachable" },
  },
});

export const healthRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  let db: "ok" | "error" = "ok";
  try {
    await c.get("db").execute(sql`select 1`);
  } catch {
    db = "error";
  }
  c.header("Cache-Control", "no-store");
  const body = {
    status: db === "ok" ? ("ok" as const) : ("degraded" as const),
    db,
    version: API_VERSION,
    time: new Date().toISOString(),
  };
  return db === "ok" ? c.json(body, 200) : c.json(body, 503);
});
