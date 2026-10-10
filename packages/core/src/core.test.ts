import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl,
  createProduct,
  createReviewJob,
  DomainError,
  finishStep,
  getJob,
  getSetting,
  listCategories,
  recordCost,
  registrableDomain,
  setSetting,
  startStep,
} from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
});

describe("url helpers", () => {
  it("reduces hosts to the registrable domain", () => {
    expect(registrableDomain("https://app.notion.so/pricing")).toBe("notion.so");
    expect(registrableDomain("www.example.co.uk")).toBe("example.co.uk");
  });
  it("blocks private and loopback hosts (SSRF)", () => {
    expect(() => assertPublicHttpUrl("http://127.0.0.1/admin")).toThrow(DomainError);
    expect(() => assertPublicHttpUrl("http://10.0.0.5")).toThrow(DomainError);
    expect(() => assertPublicHttpUrl("http://localhost:3000")).toThrow(DomainError);
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(DomainError);
    expect(assertPublicHttpUrl("https://notion.so").hostname).toBe("notion.so");
  });
});

describe("seed + categories", () => {
  it("seeds the six launch categories in order and is idempotent", async () => {
    await seed(ctx.db);
    const cats = await listCategories(ctx.db);
    expect(cats.map((c) => c.slug)).toEqual([
      "ai-tools",
      "marketing",
      "developer-tools",
      "hosting",
      "productivity",
      "new-releases",
    ]);
  });
});

describe("products", () => {
  it("creates a product and rejects a duplicate on the same registrable domain", async () => {
    const p = await createProduct(ctx.db, { name: "Notion", websiteUrl: "notion.so" });
    expect(p.slug).toBe("notion");
    expect(p.websiteUrl).toBe("https://notion.so");
    await expect(
      createProduct(ctx.db, { name: "Notion App", websiteUrl: "https://app.notion.so" }),
    ).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("allocates a unique slug when names collide across domains", async () => {
    await createProduct(ctx.db, { name: "Pilot", websiteUrl: "pilot.com" });
    const second = await createProduct(ctx.db, { name: "Pilot", websiteUrl: "pilot.ai" });
    expect(second.slug).toBe("pilot-2");
  });
});

describe("settings", () => {
  it("reads seeded defaults and validates writes", async () => {
    expect(await getSetting(ctx.db, "publishing.dailyCap")).toBe(5);
    await setSetting(ctx.db, "publishing.dailyCap", 8);
    expect(await getSetting(ctx.db, "publishing.dailyCap")).toBe(8);
    // @ts-expect-error wrong type is rejected at compile time and runtime
    await expect(setSetting(ctx.db, "publishing.dailyCap", "lots")).rejects.toThrow();
  });
});

describe("jobs, steps and the cost ledger", () => {
  it("rolls ledger costs up to step and job, and steps are idempotent per attempt", async () => {
    const job = await createReviewJob(ctx.db, { preset: "quick_review", input: { url: "https://notion.so" } });
    const first = await startStep(ctx.db, job.id, "resolve_product", { url: "https://notion.so" });
    expect(first.alreadyDone).toBe(false);

    await recordCost(
      ctx.db,
      { jobId: job.id, stepId: first.step.id },
      {
        provider: "anthropic",
        model: "claude-haiku-5-5",
        operation: "messages",
        units: 1200,
        unitType: "tokens",
        costUsd: 0.0012,
      },
    );
    await recordCost(
      ctx.db,
      { jobId: job.id, stepId: first.step.id },
      { provider: "firecrawl", operation: "scrape", units: 1, unitType: "credits", costUsd: 0.001 },
    );
    await finishStep(ctx.db, first.step.id, {
      status: "succeeded",
      output: { ok: true },
      tokensIn: 1000,
      tokensOut: 200,
    });

    const again = await startStep(ctx.db, job.id, "resolve_product", {});
    expect(again.alreadyDone).toBe(true);

    const loaded = await getJob(ctx.db, job.id);
    expect(Number(loaded!.totalCostUsd)).toBeCloseTo(0.0022, 6);
    expect(loaded!.steps).toHaveLength(1);
    expect(Number(loaded!.steps[0]!.costUsd)).toBeCloseTo(0.0022, 4);
    expect(loaded!.steps[0]!.tokensIn).toBe(1000);
  });
});

describe("dashboard stats", () => {
  it("counts products, jobs and this month's spend", async () => {
    const { getDashboardStats } = await import("./dashboard");
    await createProduct(ctx.db, { name: "Linear", websiteUrl: "linear.app" });
    const job = await createReviewJob(ctx.db, { preset: "quick_review", input: {} });
    await recordCost(
      ctx.db,
      { jobId: job.id },
      { provider: "anthropic", operation: "x", units: 1, unitType: "tokens", costUsd: 0.25 },
    );
    const stats = await getDashboardStats(ctx.db);
    expect(stats).toMatchObject({ products: 1, jobsRunning: 0, articlesAwaitingReview: 0, clicksToday: 0 });
    expect(stats.spendThisMonthUsd).toBeCloseTo(0.25, 6);
  });
});
