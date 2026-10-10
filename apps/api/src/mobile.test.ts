import {
  addArticleVersion,
  createArticle,
  ensureGoSlug,
  findOrCreateProduct,
  publishArticle,
  transitionArticle,
} from "@repo/core";
import { devices, eq } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./create-app";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: ReturnType<typeof createApp>;
let articleId: string;

// No network in tests: the rate limiter falls back to its in-process counter.
for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];

beforeAll(async () => {
  ctx = await setupTestDb();
  await ctx.reset();
  await seed(ctx.db);
  app = createApp({ db: ctx.db });
  const { product } = await findOrCreateProduct(ctx.db, { name: "Plausible", websiteUrl: "plausible.io" });
  await ensureGoSlug(ctx.db, product);
  const a = await createArticle(ctx.db, {
    type: "review",
    productId: product.id,
    title: "Plausible Review",
    slug: "plausible-review",
  });
  articleId = a.id;
  await addArticleVersion(ctx.db, a.id, {
    blocks: [{ id: "v", type: "verdict", score: 8, summary: "Lightweight analytics.", bestFor: [], notFor: [] }],
    overallScore: 8,
    qaScorecard: { hardGatesPassed: true, checks: [], computedAt: new Date().toISOString() },
  });
  await transitionArticle(ctx.db, a.id, "in_review");
  await transitionArticle(ctx.db, a.id, "approved");
  await publishArticle(ctx.db, a.id, { ignoreCap: true });
});
afterAll(async () => ctx.close());

const call = (path: string, init: RequestInit & { token?: string; ip?: string } = {}) =>
  app.request(`/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": init.ip ?? "203.0.113.7",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
  });

async function register(body: Record<string, unknown> = { platform: "ios" }, ip?: string) {
  const res = await call("/devices", { method: "POST", body: JSON.stringify(body), ip });
  expect(res.status).toBe(201);
  return (await res.json()) as { deviceId: string; token: string };
}

describe("mobile API (FR-API-4)", () => {
  it("registers a device and requires its token everywhere else", async () => {
    const { deviceId, token } = await register({ platform: "android", locale: "de", appVersion: "1.0.0" });
    expect(token.startsWith(`${deviceId}.`)).toBe(true);

    expect((await call("/devices/me")).status).toBe(401);
    expect((await call("/me/saved", { token: `${deviceId}.wrongwrongwrongwrongwrong` })).status).toBe(401);

    const me = await call("/devices/me", { token });
    expect(me.status).toBe(200);
    expect(me.headers.get("cache-control")).toBe("private, no-store");
    expect(await me.json()).toMatchObject({ deviceId, platform: "android", locale: "de", pushEnabled: false });

    const bad = await call("/devices", { method: "POST", body: JSON.stringify({ platform: "symbian" }) });
    expect(bad.status).toBe(400);
  });

  it("updates the push token, saves articles and follows prices", async () => {
    const { token } = await register();
    const patched = await call("/devices/me", {
      method: "PATCH",
      token,
      body: JSON.stringify({ pushToken: "ExponentPushToken[abcdefghijklmnop]", locale: "de" }),
    });
    expect(await patched.json()).toMatchObject({ pushEnabled: true, locale: "de" });
    const badToken = await call("/devices/me", { method: "PATCH", token, body: JSON.stringify({ pushToken: "x" }) });
    expect(badToken.status).toBe(400);

    const saved = await call("/me/saved", {
      method: "POST",
      token,
      body: JSON.stringify({ slug: "plausible-review" }),
    });
    expect(saved.status).toBe(200);
    const list = (await saved.json()) as { data: Array<Record<string, unknown>> };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ articleId, slug: "plausible-review", type: "review", locale: "en" });
    expect(String(list.data[0]!.url)).toMatch(/\/reviews\/plausible-review$/);

    const missing = await call("/me/saved", { method: "POST", token, body: JSON.stringify({ slug: "nope" }) });
    expect(missing.status).toBe(404);

    const removed = await call(`/me/saved/${articleId}`, { method: "DELETE", token });
    expect(((await removed.json()) as { data: unknown[] }).data).toHaveLength(0);

    const alert = await call("/me/alerts", { method: "POST", token, body: JSON.stringify({ product: "plausible" }) });
    expect(alert.status).toBe(200);
    expect(((await alert.json()) as { data: unknown[] }).data[0]).toMatchObject({
      productSlug: "plausible",
      productName: "Plausible",
      reviewSlug: "plausible-review",
      lastChange: null,
    });
    const unalert = await call("/me/alerts/plausible", { method: "DELETE", token });
    expect(((await unalert.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it("deletes the device and its data", async () => {
    const { deviceId, token } = await register();
    await call("/me/saved", { method: "POST", token, body: JSON.stringify({ slug: "plausible-review" }) });
    expect((await call("/devices/me", { method: "DELETE", token })).status).toBe(204);
    expect(await ctx.db.select().from(devices).where(eq(devices.id, deviceId))).toHaveLength(0);
    expect((await call("/devices/me", { token })).status).toBe(401);
  });

  it("rate-limits registration per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await call("/devices", {
        method: "POST",
        body: JSON.stringify({ platform: "ios" }),
        ip: "198.51.100.9",
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("documents the endpoints and the device token scheme", async () => {
    const doc = (await (await app.request("/openapi.json")).json()) as {
      paths: Record<string, unknown>;
      components: { securitySchemes?: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/v1/devices",
        "/v1/devices/me",
        "/v1/me/saved",
        "/v1/me/saved/{articleId}",
        "/v1/me/alerts",
      ]),
    );
    expect(doc.components.securitySchemes?.deviceToken).toMatchObject({ type: "http", scheme: "bearer" });
  });
});
