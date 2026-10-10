import { describe, expect, it } from "vitest";
import { bestWindow } from "./fact-check-core";

describe("bestWindow", () => {
  it("returns short text unchanged and finds the relevant window in long text", () => {
    expect(bestWindow("short", "x")).toBe("short");
    const text = `${"lorem ipsum dolor sit amet ".repeat(80)}The Business plan costs $19 per month with SSO. ${"filler words here ".repeat(80)}`;
    const w = bestWindow(text, "Business plan costs $19 per month", 300);
    expect(w).toContain("Business plan costs $19");
    expect(w.length).toBeLessThanOrEqual(302);
  });
});
