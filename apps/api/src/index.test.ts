import { describe, expect, it } from "vitest";

describe("vercel entrypoint", () => {
  it("default-exports a Hono app that serves the OpenAPI document without touching the database", async () => {
    const { default: app } = await import("./index");
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { openapi: string }).openapi).toBe("3.1.0");
  });
});
