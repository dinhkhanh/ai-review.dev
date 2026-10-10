import { OpenAPIHono } from "@hono/zod-openapi";
import { API_VERSION } from "@repo/contracts";
import { DomainError } from "@repo/core";
import type { Database } from "@repo/db";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { categoriesRoutes } from "./routes/categories";
import { healthRoutes } from "./routes/health";
import { productsRoutes } from "./routes/products";
import { reviewsRoutes } from "./routes/reviews";

export type AppEnv = { Variables: { db: Database } };

export interface CreateAppOptions {
  /** A database handle, or a factory resolved on first request (keeps imports connection-free). */
  db: Database | (() => Database);
  allowedOrigins?: string[];
}

/** Public REST API (apps/api, FR-API-1/2). Read-only; consumed by the mobile app and web client features. */
export function createApp(options: CreateAppOptions) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: { code: "invalid_request", message: result.error.issues.map((i) => i.message).join("; ") } },
          400,
        );
      }
    },
  });

  app.use("*", secureHeaders());
  app.use(
    "/v1/*",
    cors({
      origin: options.allowedOrigins ?? [process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      maxAge: 600,
    }),
  );
  const resolveDb = typeof options.db === "function" ? options.db : () => options.db as Database;
  app.use("*", async (c, next) => {
    c.set("db", resolveDb());
    await next();
  });

  app.route("/v1", healthRoutes);
  app.route("/v1", categoriesRoutes);
  app.route("/v1", reviewsRoutes);
  app.route("/v1", productsRoutes);

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "AI Review API",
      version: API_VERSION,
      description: "Public read API for ai-review.dev web and mobile clients.",
    },
    servers: [
      { url: "https://api.ai-review.dev", description: "Production" },
      { url: "http://localhost:3002", description: "Local development" },
    ],
  });
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "AI Review API" }));
  app.get("/", (c) => c.redirect("/docs"));

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      const status =
        err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : err.code === "forbidden" ? 403 : 400;
      return c.json({ error: { code: err.code, message: err.message } }, status);
    }
    console.error(err);
    return c.json({ error: { code: "internal", message: "Internal server error" } }, 500);
  });

  return app;
}
