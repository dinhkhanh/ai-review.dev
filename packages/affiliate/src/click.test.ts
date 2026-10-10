import { describe, expect, it } from "vitest";
import { clientIpFrom, deviceClass, hashWithDailySalt, isBotUserAgent } from "./click";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15";

describe("click classification", () => {
  it("flags crawlers, previews, scripts and missing UAs as bots", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isBotUserAgent("curl/8.7.1")).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent(MAC)).toBe(false);
  });
  it("classifies devices", () => {
    expect(deviceClass(IPHONE)).toBe("mobile");
    expect(deviceClass(ANDROID_PHONE)).toBe("mobile");
    expect(deviceClass(IPAD)).toBe("tablet");
    expect(deviceClass(ANDROID_TABLET)).toBe("tablet");
    expect(deviceClass(MAC)).toBe("desktop");
    expect(deviceClass("Googlebot")).toBe("bot");
  });
  it("hashes IPs with a salt that rotates daily", async () => {
    const d1 = new Date("2026-10-10T01:00:00Z");
    const d1b = new Date("2026-10-10T23:00:00Z");
    const d2 = new Date("2026-10-11T01:00:00Z");
    const a = await hashWithDailySalt("1.2.3.4", "s", d1);
    expect(a).toHaveLength(32);
    expect(await hashWithDailySalt("1.2.3.4", "s", d1b)).toBe(a);
    expect(await hashWithDailySalt("1.2.3.4", "s", d2)).not.toBe(a);
    expect(await hashWithDailySalt("1.2.3.4", "other", d1)).not.toBe(a);
    expect(await hashWithDailySalt(null, "s")).toBeNull();
    expect(await hashWithDailySalt("1.2.3.4", "s")).toHaveLength(32);
  });
  it("reads the client IP from X-Forwarded-For", () => {
    expect(clientIpFrom("203.0.113.9, 10.0.0.1")).toBe("203.0.113.9");
    expect(clientIpFrom(" ")).toBeNull();
    expect(clientIpFrom(null)).toBeNull();
  });
});
