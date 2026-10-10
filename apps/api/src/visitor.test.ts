import {
  addArticleVersion,
  createArticle,
  createDeal,
  ensureGoSlug,
  findOrCreateProduct,
  helpfulVoteCounts,
  listErrorReports,
  publishArticle,
  transitionArticle,
} from "@repo/core";
import { newsletterSubscribers } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./create-app";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: ReturnType<typeof createApp>;
let articleId: string;

// No network in tests: no Turnstile, Upstash or Resend calls.
for (const k of ["TURNSTILE_SECRET_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "RESEND_API_KEY"]) {
  delete process.env[k];
}

beforeAll(async () => {
  ctx = await setupTestDb();
  await ctx.reset();
  await seed(ctx.db);
  app = createApp({ db: ctx.db, allowedOrigins: ["http://localhost:3000"] });
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
    blocks: [
      { id: "v", type: "verdict", score: 8, summary: "Lightweight analytics.", bestFor: [], notFor: [] },
      { id: "p", type: "paragraph", children: [{ text: "Cookieless website analytics without banners.", marks: [] }] },
    ],
    overallScore: 8,
    qaScorecard: { hardGatesPassed: true, checks: [], computedAt: new Date().toISOString() },
  });
  await transitionArticle(ctx.db, a.id, "in_review");
  await transitionArticle(ctx.db, a.id, "approved");
  await publishArticle(ctx.db, a.id);
  await createDeal(ctx.db, { productId: product.id, title: "Plausible: 30-day trial", discountText: "30-day trial" });
});
afterAll(async () => ctx.close());

const post = (path: string, body: unknown, ip = "203.0.113.7") =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });

describe("search and deals (FR-WEB-7, FR-WEB-8)", () => {
  it("GET /v1/search returns typed results with web URLs", async () => {
    const res = await app.request("/v1/search?q=cookieless%20analytics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ slug: string; type: string; url: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ slug: "plausible-review", type: "review" });
    expect(body.data[0]!.url).toMatch(/\/reviews\/plausible-review$/);
    expect((await app.request("/v1/search")).status).toBe(400);
  });

  it("GET /v1/deals lists active deals with the go-link slug", async () => {
    const body = (await (await app.request("/v1/deals")).json()) as {
      data: Array<{ title: string; links: { go: string }; reviewSlug: string }>;
    };
    expect(body.data).toEqual([
      expect.objectContaining({
        title: "Plausible: 30-day trial",
        reviewSlug: "plausible-review",
        links: expect.objectContaining({ go: "plausible" }),
      }),
    ]);
  });
});

describe("visitor writes (FR-API-3)", () => {
  it("records one changeable vote per visitor and 404s unknown reviews", async () => {
    expect((await post("/v1/reviews/plausible-review/vote", { helpful: true })).status).toBe(202);
    expect((await post("/v1/reviews/plausible-review/vote", { helpful: false })).status).toBe(202);
    expect((await post("/v1/reviews/plausible-review/vote", { helpful: true }, "198.51.100.2")).status).toBe(202);
    expect(await helpfulVoteCounts(ctx.db, articleId)).toEqual({ helpful: 1, notHelpful: 1 });
    expect((await post("/v1/reviews/nope/vote", { helpful: true })).status).toBe(404);
    expect((await post("/v1/reviews/plausible-review/vote", { helpful: "yes" })).status).toBe(400);
  });

  it("accepts reports and rate-limits repeated ones", async () => {
    const ip = "192.0.2.50";
    const report = { article: "plausible-review", kind: "pricing", message: "The Growth plan is now $14." };
    for (let i = 0; i < 5; i++) expect((await post("/v1/reports", report, ip)).status).toBe(202);
    const limited = await post("/v1/reports", report, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    const reports = await listErrorReports(ctx.db);
    expect(reports[0]).toMatchObject({ articleId, kind: "pricing" });
  });

  it("subscribes with the same answer for new and known addresses", async () => {
    const first = await post("/v1/newsletter", { email: "reader@example.com" }, "192.0.2.60");
    const again = await post("/v1/newsletter", { email: "reader@example.com" }, "192.0.2.60");
    expect(first.status).toBe(202);
    expect(await again.json()).toEqual(await first.json());
    const rows = await ctx.db.select().from(newsletterSubscribers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.confirmedAt).toBeNull();
    expect((await post("/v1/newsletter", { email: "nope" })).status).toBe(400);
  });

  it("documents the new endpoints", async () => {
    const doc = (await (await app.request("/openapi.json")).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/search", "/v1/deals", "/v1/reviews/{slug}/vote", "/v1/reports", "/v1/newsletter"]),
    );
  });
});
