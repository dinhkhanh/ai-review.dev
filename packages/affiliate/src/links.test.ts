import { describe, expect, it } from "vitest";
import { buildSubId, buildTrackedUrl, parseSubId, sanitizeToken, withUtm, wrapCatchAll } from "./links";

describe("sanitizeToken", () => {
  it("lowercases, replaces unsafe runs and trims hyphens", () => {
    expect(sanitizeToken("  Notion AI / Review!! ")).toBe("notion-ai-review");
    expect(sanitizeToken(null)).toBe("");
    expect(sanitizeToken(undefined)).toBe("");
    expect(sanitizeToken("abcdef", 3)).toBe("abc");
  });
});

describe("buildSubId / parseSubId", () => {
  it("joins article slug and placement", () => {
    expect(buildSubId("notion-review", "sticky_mobile")).toBe("notion-review--sticky_mobile");
  });
  it("falls back when parts are missing", () => {
    expect(buildSubId(null, undefined)).toBe("go--direct");
    expect(buildSubId("", "")).toBe("go--direct");
  });
  it("stays within 64 characters", () => {
    expect(buildSubId("x".repeat(100), "y".repeat(100)).length).toBeLessThanOrEqual(64);
  });
  it("round-trips", () => {
    expect(parseSubId("notion-review--verdict")).toEqual({ articleSlug: "notion-review", placement: "verdict" });
    expect(parseSubId("go--direct")).toEqual({ articleSlug: null, placement: null });
    expect(parseSubId("lonely")).toEqual({ articleSlug: "lonely", placement: null });
    expect(parseSubId("")).toEqual({ articleSlug: null, placement: null });
  });
});

describe("buildTrackedUrl", () => {
  it("returns the destination unchanged when there is no format", () => {
    expect(buildTrackedUrl("https://vendor.com/pricing?a=1", null, { subId: "x--y" })).toBe(
      "https://vendor.com/pricing?a=1",
    );
  });
  it("adds the network's SubID to pasted links without a stored format", () => {
    expect(buildTrackedUrl("https://notion.grsm.io/x", null, { subId: "a--b", network: "partnerstack" })).toBe(
      "https://notion.grsm.io/x?ps_xid=a--b",
    );
  });
  it("sets the referral param, replacing an existing value instead of duplicating it", () => {
    const url = buildTrackedUrl("https://vendor.com/?via=old&x=1", {
      kind: "query_param",
      param: "via",
      value: "aireview",
    });
    expect(url).toBe("https://vendor.com/?via=aireview&x=1");
  });
  it("adds a sub-id for query-param programs when the scheme has one", () => {
    const url = buildTrackedUrl(
      "https://vendor.com/",
      { kind: "query_param", param: "fpr", value: "abc", subIdParam: "fp_sid" },
      { subId: "notion-review--verdict" },
    );
    expect(new URL(url).searchParams.get("fp_sid")).toBe("notion-review--verdict");
  });
  it("uses the program network's default sub-id param for query-param programs", () => {
    const url = buildTrackedUrl(
      "https://vendor.com/",
      { kind: "query_param", param: "via", value: "abc" },
      { subId: "s--p", network: "rewardful" },
    );
    expect(new URL(url).searchParams.get("sub_id")).toBe("s--p");
  });
  it("does not invent a sub-id param when the network has none", () => {
    expect(
      buildTrackedUrl(
        "https://vendor.com/",
        { kind: "query_param", param: "ref", value: "a" },
        { subId: "s--p", network: "direct" },
      ),
    ).toBe("https://vendor.com/?ref=a");
    expect(
      buildTrackedUrl("https://vendor.com/", { kind: "query_param", param: "ref", value: "a" }, { subId: "s--p" }),
    ).toBe("https://vendor.com/?ref=a");
  });
  it("appends the network's documented sub-id param to network links", () => {
    const url = buildTrackedUrl(
      "https://vendor.sjv.io/c/1/2/3",
      { kind: "network_link", network: "impact" },
      { subId: "a--b" },
    );
    expect(url).toBe("https://vendor.sjv.io/c/1/2/3?subId1=a--b");
  });
  it("prefers an explicit sub-id param over the network default", () => {
    const url = buildTrackedUrl(
      "https://www.awin1.com/cread.php?awinmid=1&awinaffid=2",
      { kind: "network_link", network: "awin", subIdParam: "custom" },
      { subId: "a--b" },
    );
    expect(new URL(url).searchParams.get("custom")).toBe("a--b");
    expect(new URL(url).searchParams.get("clickref")).toBeNull();
  });
  it("skips the sub-id for networks without one, and when no sub-id is given", () => {
    expect(buildTrackedUrl("https://amzn.to/x", { kind: "network_link", network: "amazon" }, { subId: "a--b" })).toBe(
      "https://amzn.to/x",
    );
    expect(buildTrackedUrl("https://vendor.sjv.io/c/1", { kind: "network_link", network: "impact" })).toBe(
      "https://vendor.sjv.io/c/1",
    );
  });
  it("appends a sub-id to static URLs only when the param is known", () => {
    expect(buildTrackedUrl("https://v.com/r/abc", { kind: "static_url", subIdParam: "sid" }, { subId: "a--b" })).toBe(
      "https://v.com/r/abc?sid=a--b",
    );
    expect(buildTrackedUrl("https://v.com/r/abc", { kind: "static_url" }, { subId: "a--b" })).toBe(
      "https://v.com/r/abc",
    );
  });
  it("never double-encodes values already present in the destination", () => {
    const url = buildTrackedUrl(
      "https://v.com/?next=%2Fpricing%3Fplan%3Dpro",
      { kind: "static_url", subIdParam: "sid" },
      { subId: "a--b" },
    );
    expect(url).toBe("https://v.com/?next=%2Fpricing%3Fplan%3Dpro&sid=a--b");
    expect(new URL(url).searchParams.get("next")).toBe("/pricing?plan=pro");
  });
  it("rejects non-http destinations and garbage", () => {
    expect(() => buildTrackedUrl("javascript:alert(1)", null)).toThrow(/http/);
    expect(() => buildTrackedUrl("not a url", null)).toThrow();
  });
});

describe("withUtm", () => {
  it("adds UTM parameters with defaults", () => {
    const url = new URL(withUtm("https://vendor.com/", { campaign: "Notion Review", content: "Sticky Mobile" }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: "ai-review.dev",
      utm_medium: "referral",
      utm_campaign: "notion-review",
      utm_content: "sticky-mobile",
    });
  });
  it("keeps existing UTM values and omits empty content", () => {
    const url = new URL(
      withUtm("https://vendor.com/?utm_source=partner", {
        campaign: "x",
        source: "other",
        medium: "cpc",
        content: null,
      }),
    );
    expect(url.searchParams.get("utm_source")).toBe("partner");
    expect(url.searchParams.get("utm_medium")).toBe("cpc");
    expect(url.searchParams.has("utm_content")).toBe(false);
  });
  it("omits an empty campaign", () => {
    expect(new URL(withUtm("https://vendor.com/", { campaign: "!!!" })).searchParams.has("utm_campaign")).toBe(false);
  });
});

describe("wrapCatchAll", () => {
  it("rejects non-http destinations", () => {
    expect(() => wrapCatchAll("javascript:alert(1)", { network: "skimlinks", publisherId: "x" }, "s")).toThrow();
  });
});
