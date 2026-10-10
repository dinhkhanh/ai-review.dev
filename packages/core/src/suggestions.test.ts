import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptSuggestion,
  findOrCreateProduct,
  getJob,
  knownDomains,
  listSuggestions,
  setSuggestionStatus,
  suggestionCounts,
  upsertSuggestion,
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

const base = { source: "producthunt", signals: { launchUrl: "https://www.producthunt.com/products/x" } };

describe("product suggestions (FR-INT-7)", () => {
  it("upserts by registrable domain and ranks new suggestions by score", async () => {
    const a = await upsertSuggestion(ctx.db, { ...base, name: "Alpha", url: "https://app.alpha.io/x", score: 2 });
    expect(a.created).toBe(true);
    expect(a.suggestion?.domain).toBe("alpha.io");
    expect(a.suggestion?.url).toBe("https://app.alpha.io");
    await upsertSuggestion(ctx.db, { ...base, name: "Beta", url: "beta.dev", score: 5, categorySlug: "ai-tools" });
    const again = await upsertSuggestion(ctx.db, { ...base, name: "Alpha 2", url: "alpha.io", score: 9 });
    expect(again.created).toBe(false);
    expect(again.suggestion?.name).toBe("Alpha 2");

    const ranked = await listSuggestions(ctx.db, { status: "new" });
    expect(ranked.map((s) => s.name)).toEqual(["Alpha 2", "Beta"]);
    expect(await listSuggestions(ctx.db, { categorySlug: "ai-tools" })).toHaveLength(1);
    expect(await knownDomains(ctx.db, ["alpha.io", "gamma.com"])).toEqual(new Set(["alpha.io"]));
  });

  it("never resurrects dismissed suggestions and knows existing products", async () => {
    const { suggestion } = await upsertSuggestion(ctx.db, { ...base, name: "Alpha", url: "alpha.io", score: 2 });
    await setSuggestionStatus(ctx.db, suggestion!.id, "dismissed");
    const again = await upsertSuggestion(ctx.db, { ...base, name: "Alpha", url: "alpha.io", score: 7 });
    expect(again.suggestion?.status).toBe("dismissed");
    expect(Number(again.suggestion?.score)).toBe(2);
    await findOrCreateProduct(ctx.db, { name: "Notion", websiteUrl: "https://www.notion.so" });
    expect(await knownDomains(ctx.db, ["notion.so"])).toEqual(new Set(["notion.so"]));
    expect(await suggestionCounts(ctx.db)).toEqual({ new: 0, accepted: 0, dismissed: 1 });
  });

  it("accepts into a review job, or a refresh when the product exists", async () => {
    const { suggestion } = await upsertSuggestion(ctx.db, {
      ...base,
      name: "Alpha",
      url: "alpha.io",
      score: 2,
      categorySlug: "productivity",
    });
    const job = await acceptSuggestion(ctx.db, suggestion!.id, "user-1");
    expect(job.preset).toBe("quick_review");
    expect(job.input).toMatchObject({ url: "https://alpha.io", name: "Alpha", categorySlug: "productivity" });
    const [row] = await listSuggestions(ctx.db, { status: "accepted" });
    expect(row?.jobId).toBe(job.id);
    await expect(acceptSuggestion(ctx.db, suggestion!.id)).rejects.toThrow(/already accepted/);
    await expect(setSuggestionStatus(ctx.db, suggestion!.id, "dismissed")).rejects.toThrow();

    const { product } = await findOrCreateProduct(ctx.db, { name: "Notion", websiteUrl: "https://www.notion.so" });
    const s2 = await upsertSuggestion(ctx.db, { ...base, name: "Notion", url: "notion.so", score: 1 });
    const refresh = await acceptSuggestion(ctx.db, s2.suggestion!.id);
    expect(refresh.preset).toBe("refresh");
    expect((await getJob(ctx.db, refresh.id))?.productId).toBe(product.id);
  });
});
