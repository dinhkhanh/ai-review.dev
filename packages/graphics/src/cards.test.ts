import { describe, expect, it } from "vitest";
import {
  BADGE_SIZE,
  CARD_HEIGHT,
  CARD_WIDTH,
  formatPrice,
  renderPricingCard,
  renderProsConsCard,
  renderScoreBadge,
} from "./index";

const dims = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe("cards", () => {
  it("formats prices", () => {
    expect(formatPrice(null, "USD", "month")).toBe("Custom");
    expect(formatPrice(0, "USD", "month")).toBe("Free");
    expect(formatPrice(12, "USD", "month")).toBe("$12/mo");
    expect(formatPrice(9.5, "EUR", "year")).toBe("€9.50/yr");
  });
  it("renders the pricing, pros/cons and badge PNGs at their sizes", async () => {
    const pricing = await renderPricingCard({
      productName: "Notion",
      verifiedAt: new Date("2026-10-10"),
      tiers: [
        { name: "Free", price: 0, currency: "USD", period: "month", highlights: ["Unlimited pages"] },
        {
          name: "Plus",
          price: 10,
          currency: "USD",
          period: "month",
          highlights: ["Unlimited uploads", "30-day history"],
        },
      ],
    });
    expect(dims(pricing.png)).toEqual([CARD_WIDTH, CARD_HEIGHT]);
    const pc = await renderProsConsCard({ productName: "Notion", pros: ["Flexible"], cons: ["Learning curve"] });
    expect(dims(pc.png)).toEqual([CARD_WIDTH, CARD_HEIGHT]);
    const badge = await renderScoreBadge({ score: 8.6, productName: "Notion" });
    expect(dims(badge.png)).toEqual([BADGE_SIZE, BADGE_SIZE]);
    expect(badge.svg).toContain("<svg");
  }, 30_000);
});
