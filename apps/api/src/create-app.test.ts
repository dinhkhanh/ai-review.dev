import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./create-app";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await setupTestDb();
  await ctx.reset();
  await seed(ctx.db);
  app = createApp({ db: ctx.db, allowedOrigins: ["http://localhost:3000"] });
});
afterAll(async () => ctx.close());

describe("api v1", () => {
  it("GET /v1/health reports db ok", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
  });

  it("GET /v1/categories returns launch categories with cache headers", async () => {
    const res = await app.request("/v1/categories");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage");
    const body = (await res.json()) as { data: Array<{ slug: string }> };
    expect(body.data.map((c) => c.slug)).toContain("hosting");
    expect(body.data).toHaveLength(6);
  });

  it("serves an OpenAPI 3.1 document listing the v1 routes", async () => {
    const doc = (await (await app.request("/openapi.json")).json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/v1/health", "/v1/categories"]));
  });

  it("returns JSON 404s and applies CORS to allowed origins only", async () => {
    expect((await app.request("/v1/nope")).status).toBe(404);
    const ok = await app.request("/v1/categories", { headers: { Origin: "http://localhost:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const bad = await app.request("/v1/categories", { headers: { Origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});
