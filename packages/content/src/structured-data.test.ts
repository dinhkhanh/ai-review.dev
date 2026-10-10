import { describe, expect, it } from "vitest";
import { buildReviewStructuredData, factSheetSchema, isoDuration, validateStructuredData } from "./index";

const factSheet = factSheetSchema.parse({
  name: "Notion",
  website: "https://notion.so",
  pricing: {
    tiers: {
      value: [
        { name: "Free", price: 0, period: "month" },
        { name: "Plus", price: 10, period: "month" },
      ],
    },
  },
  platforms: { value: ["Web", "macOS", "iOS"] },
});

const input = {
  siteUrl: "https://ai-review.dev",
  siteName: "AI Review",
  url: "https://ai-review.dev/reviews/notion",
  title: "Notion Review 2026",
  description: "Our verdict.",
  publishedAt: new Date("2026-10-10T00:00:00Z"),
  updatedAt: new Date("2026-10-11T00:00:00Z"),
  imageUrl: "https://media.ai-review.dev/og.png",
  author: { name: "Editor", url: "https://ai-review.dev/authors/editor" },
  product: { name: "Notion", websiteUrl: "https://notion.so", category: "Productivity" },
  score: 8.4,
  factSheet,
  blocks: [
    {
      id: "f",
      type: "faq" as const,
      items: [{ question: "Is Notion free?", answer: [{ text: "Yes, for individuals.", marks: [] }] }],
    },
  ],
  breadcrumbs: [
    { name: "Home", url: "https://ai-review.dev" },
    { name: "Notion Review", url: "https://ai-review.dev/reviews/notion" },
  ],
};

describe("structured data", () => {
  it("matches the snapshot and validates", () => {
    const objects = buildReviewStructuredData(input);
    expect(objects).toMatchSnapshot();
    expect(validateStructuredData(objects)).toEqual([]);
  });
  it("never emits AggregateRating", () => {
    expect(JSON.stringify(buildReviewStructuredData(input))).not.toContain("AggregateRating");
  });
  it("reports missing required fields", () => {
    const objects = buildReviewStructuredData({ ...input, score: null, factSheet: null, blocks: [], breadcrumbs: [] });
    expect(validateStructuredData(objects)).toEqual([
      "Review.reviewRating.ratingValue is required",
      "SoftwareApplication.offers.price is required",
      "BreadcrumbList is missing",
    ]);
    expect(validateStructuredData([])).toContain("Missing SoftwareApplication object");
  });
  it("uses price 0 for free-only products", () => {
    const freeOnly = factSheetSchema.parse({
      name: "X",
      website: "https://x.com",
      pricing: { tiers: { value: [{ name: "Custom", price: null, period: "custom" }] }, freePlan: { value: true } },
    });
    const [app] = buildReviewStructuredData({ ...input, factSheet: freeOnly });
    expect(app!.offers).toEqual({ "@type": "Offer", price: 0, priceCurrency: "USD" });
  });
  it("adds a valid VideoObject per uploaded video (FR-VID-4)", () => {
    const objects = buildReviewStructuredData({
      ...input,
      videos: [
        {
          name: "Notion review",
          description: "Our verdict in 90 seconds.",
          thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
          uploadDate: new Date("2026-10-11T00:00:00Z"),
          embedUrl: "https://www.youtube-nocookie.com/embed/abc",
          watchUrl: "https://www.youtube.com/shorts/abc",
          durationSeconds: 95,
        },
      ],
    });
    const video = objects.find((o) => o["@type"] === "VideoObject");
    expect(video).toMatchObject({ duration: "PT1M35S", uploadDate: "2026-10-11T00:00:00.000Z" });
    expect(validateStructuredData(objects)).toEqual([]);
    expect(isoDuration(60)).toBe("PT1M");
    expect(isoDuration(9)).toBe("PT9S");
    expect(validateStructuredData([...objects, { "@type": "VideoObject", name: "x" }])).toContain(
      "VideoObject needs name, description, thumbnailUrl and uploadDate",
    );
  });
});
