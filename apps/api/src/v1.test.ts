import { createApiClient } from "@repo/contracts/client";
import {
  addArticleVersion,
  createArticle,
  ensureGoSlug,
  findOrCreateProduct,
  publishArticle,
  saveFactSheet,
  transitionArticle,
  upsertSource,
} from "@repo/core";
import { factSheetSchema } from "@repo/content";
import { categories, eq } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./create-app";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await setupTestDb();
  await ctx.reset();
  await seed(ctx.db);
  app = createApp({ db: ctx.db, allowedOrigins: ["http://localhost:3000"] });
  const [cat] = await ctx.db.select().from(categories).where(eq(categories.slug, "productivity"));
  const { product } = await findOrCreateProduct(ctx.db, {
    name: "Notion",
    websiteUrl: "notion.so",
    categoryId: cat!.id,
  });
  await ensureGoSlug(ctx.db, product);
  const src = await upsertSource(ctx.db, {
    productId: product.id,
    url: "https://notion.so/pricing",
    kind: "official",
    title: "Pricing",
  });
  await saveFactSheet(
    ctx.db,
    product.id,
    factSheetSchema.parse({
      name: "Notion",
      website: "https://notion.so",
      pricing: { tiers: { value: [{ name: "Plus", price: 10, period: "month" }], citations: [{ sourceId: src.id }] } },
    }),
  );
  const a = await createArticle(ctx.db, {
    type: "review",
    productId: product.id,
    title: "Notion Review",
    slug: "notion-review",
  });
  await addArticleVersion(ctx.db, a.id, {
    blocks: [
      { id: "v", type: "verdict", score: 8.1, summary: "Great.", bestFor: [], notFor: [] },
      {
        id: "p",
        type: "paragraph",
        children: [
          { text: "Plus is $10.", marks: [] },
          { text: "", marks: [{ type: "citation", citation: { sourceId: src.id } }] },
        ],
      },
      { id: "c", type: "cta", goSlug: "notion", placement: "verdict", label: "Try Notion" },
    ],
    seo: {
      title: "Notion Review 2026",
      metaDescription: "Our verdict",
      primaryKeyword: "notion review",
      secondaryKeywords: [],
      intent: "review",
      internalLinks: [],
    },
    overallScore: 8.1,
    qaScorecard: { hardGatesPassed: true, checks: [], computedAt: new Date().toISOString() },
  });
  await transitionArticle(ctx.db, a.id, "in_review");
  await transitionArticle(ctx.db, a.id, "approved");
  await publishArticle(ctx.db, a.id);
  // A draft that must never appear in the public API.
  const { product: other } = await findOrCreateProduct(ctx.db, { name: "Coda", websiteUrl: "coda.io" });
  await createArticle(ctx.db, { type: "review", productId: other.id, title: "Coda Review", slug: "coda-review" });
});
afterAll(async () => ctx.close());

describe("api v1 content", () => {
  it("lists published reviews only, with cache tags", async () => {
    const res = await app.request("/v1/reviews?category=productivity");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-tag")).toContain("category:productivity");
    const body = (await res.json()) as { data: Array<{ slug: string; score: number }>; pagination: { total: number } };
    expect(body.data.map((r) => r.slug)).toEqual(["notion-review"]);
    expect(body.pagination.total).toBe(1);
    const search = (await (await app.request("/v1/reviews?q=coda")).json()) as { data: unknown[] };
    expect(search.data).toHaveLength(0);
  });

  it("returns a review with blocks, sources and go-link slug; 404 for drafts", async () => {
    const res = await app.request("/v1/reviews/notion-review");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.blocks).toHaveLength(3);
    expect(body.sources).toHaveLength(1);
    expect(body.links.go).toBe("notion");
    expect(body.product.name).toBe("Notion");
    expect(body.aiDisclosure).toContain("AI");
    expect((await app.request("/v1/reviews/coda-review")).status).toBe(404);
  });

  it("serves products with verified pricing and category details", async () => {
    const list = (await (await app.request("/v1/products")).json()) as { data: Array<{ slug: string }> };
    expect(list.data.map((p) => p.slug)).toEqual(["notion"]);
    const product = (await (await app.request("/v1/products/notion")).json()) as Record<string, any>;
    expect(product.pricing.tiers[0]).toMatchObject({ name: "Plus", price: 10 });
    expect(product.goSlug).toBe("notion");
    expect((await app.request("/v1/products/coda")).status).toBe(404);
    const cat = (await (await app.request("/v1/categories/productivity")).json()) as { reviews: unknown[] };
    expect(cat.reviews).toHaveLength(1);
    expect((await app.request("/v1/categories/nope")).status).toBe(404);
  });

  it("validates query parameters", async () => {
    expect((await app.request("/v1/reviews?limit=500")).status).toBe(400);
  });
});

describe("contract (NFR-12)", () => {
  it("committed packages/contracts/openapi.json matches the code (run `pnpm --filter api generate-client`)", async () => {
    const live = await (await app.request("/openapi.json")).json();
    const committed = JSON.parse(
      readFileSync(new URL("../../../packages/contracts/openapi.json", import.meta.url), "utf8"),
    );
    expect(live).toEqual(committed);
  });

  it("the generated typed client works against the app", async () => {
    const api = createApiClient("http://api.test", {
      fetch: (input) => app.fetch(input as Request) as Promise<Response>,
    });
    const { data, error } = await api.GET("/v1/reviews/{slug}", { params: { path: { slug: "notion-review" } } });
    expect(error).toBeUndefined();
    expect(data?.blocks[0]?.type).toBe("verdict");
  });
});
