import { describe, expect, it, vi } from "vitest";
import { createFirecrawl, rateLimitDelay, type FirecrawlLike } from "./index";

describe("createFirecrawl", () => {
  it("maps scrape results and records credits", async () => {
    const client: FirecrawlLike = {
      scrape: vi.fn(async () => ({
        markdown: "# Pricing",
        links: ["https://x.com/a"],
        screenshot: "https://shot",
        metadata: { title: "Pricing", sourceURL: "https://x.com/pricing", statusCode: 200, creditsUsed: 1 },
      })),
      search: vi.fn(async () => ({
        web: [{ url: "https://a.com", title: "A", description: "d" }, { url: "https://b.com" }],
      })),
      map: vi.fn(async () => ({ links: [{ url: "https://x.com/" }, { url: "https://x.com/pricing" }] })),
    } as unknown as FirecrawlLike;
    const onCost = vi.fn();
    const fc = createFirecrawl({ client, onCost, creditPriceUsd: 0.002, pacing: { rpm: 6000 } });

    const page = await fc.scrape("https://x.com/pricing", { screenshot: true });
    expect(page).toMatchObject({
      title: "Pricing",
      markdown: "# Pricing",
      screenshotUrl: "https://shot",
      statusCode: 200,
    });
    expect(onCost).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: "firecrawl", operation: "scrape", units: 1, costUsd: 0.002 }),
    );

    const hits = await fc.search("notion review", { limit: 5 });
    expect(hits.map((h) => h.url)).toEqual(["https://a.com", "https://b.com"]);

    expect(await fc.map("https://x.com")).toEqual(["https://x.com/", "https://x.com/pricing"]);
    expect(onCost).toHaveBeenCalledTimes(3);
  });
});

describe("rate limits", () => {
  it("parses retry-after from Firecrawl errors", () => {
    expect(rateLimitDelay(new Error("Rate limit exceeded. please retry after 46s, resets at"))).toBe(47);
    expect(rateLimitDelay(new Error("HTTP 429"))).toBe(30);
    expect(rateLimitDelay(new Error("boom"))).toBeNull();
  });
  it("waits and retries after a rate-limit error", async () => {
    let calls = 0;
    const client = {
      scrape: vi.fn(async () => {
        if (calls++ === 0) throw new Error("Rate limit exceeded. retry after 2s");
        return { markdown: "ok", metadata: {} };
      }),
    } as unknown as FirecrawlLike;
    const sleep = vi.fn(async () => {});
    const fc = createFirecrawl({ client, pacing: { rpm: 6000, sleep } });
    expect((await fc.scrape("https://x.com")).markdown).toBe("ok");
    expect(sleep).toHaveBeenCalledWith(3000);
  });
  it("gives up after maxRetries and rethrows non-rate-limit errors", async () => {
    const limited = { scrape: vi.fn(async () => Promise.reject(new Error("429"))) } as unknown as FirecrawlLike;
    await expect(
      createFirecrawl({ client: limited, pacing: { rpm: 6000, maxRetries: 1, sleep: async () => {} } }).scrape(
        "https://x.com",
      ),
    ).rejects.toThrow("429");
    expect(limited.scrape).toHaveBeenCalledTimes(2);
  });
});
