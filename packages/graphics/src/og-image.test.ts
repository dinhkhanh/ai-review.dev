import { describe, expect, it } from "vitest";
import { OG_HEIGHT, OG_SCALE, OG_WIDTH, renderOgImage } from "./index";

describe("renderOgImage", () => {
  it("renders a 2400x1260 PNG with the title and score", async () => {
    const { png, svg } = await renderOgImage({ title: "Notion Review 2026", category: "Productivity", score: 8.6 });
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(OG_WIDTH * OG_SCALE);
    expect(png.readUInt32BE(20)).toBe(OG_HEIGHT * OG_SCALE);
    expect(svg).toContain("<svg");
  }, 20_000);
});
