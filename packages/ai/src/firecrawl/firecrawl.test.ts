import { describe, expect, it, vi } from "vitest";
import { createFirecrawl, type FirecrawlLike } from "./index";

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
    const fc = createFirecrawl({ client, onCost, creditPriceUsd: 0.002 });

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
