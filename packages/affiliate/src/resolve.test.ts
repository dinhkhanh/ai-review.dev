import { describe, expect, it } from "vitest";
import { ctaTarget, isLinkEligible, resolveGoLink, selectLink, type GoLinkTable, type LinkCandidate } from "./resolve";

const NOW = new Date("2026-10-10T12:00:00Z");

function link(overrides: Partial<LinkCandidate> = {}): LinkCandidate {
  return {
    id: "l1",
    destinationUrl: "https://vendor.com/",
    region: "global",
    status: "active",
    priority: 100,
    weight: 100,
    startsAt: null,
    endsAt: null,
    program: {
      id: "p1",
      status: "active",
      network: "direct",
      redirectPolicy: "allowed",
      linkFormat: { kind: "query_param", param: "via", value: "aireview" },
    },
    ...overrides,
  };
}

function table(links: LinkCandidate[]): GoLinkTable {
  return { slug: "notion", productId: "prod", fallbackUrl: "https://notion.so", links };
}

describe("isLinkEligible", () => {
  it("requires active link and active program inside the date window", () => {
    expect(isLinkEligible(link(), NOW)).toBe(true);
    expect(isLinkEligible(link({ status: "paused" }), NOW)).toBe(false);
    expect(isLinkEligible(link({ program: { ...link().program!, status: "approved" } }), NOW)).toBe(false);
    expect(isLinkEligible(link({ program: null }), NOW)).toBe(true);
    expect(isLinkEligible(link({ startsAt: new Date("2026-11-01") }), NOW)).toBe(false);
    expect(isLinkEligible(link({ startsAt: new Date("2026-01-01") }), NOW)).toBe(true);
    expect(isLinkEligible(link({ endsAt: NOW }), NOW)).toBe(false);
    expect(isLinkEligible(link({ endsAt: new Date("2027-01-01") }), NOW)).toBe(true);
  });
});

describe("selectLink", () => {
  it("returns null when nothing is eligible", () => {
    expect(selectLink([link({ status: "broken" })], { now: NOW })).toBeNull();
    expect(selectLink([], {})).toBeNull();
  });
  it("prefers links for the visitor's country, then global", () => {
    const links = [link({ id: "global" }), link({ id: "de", region: "DE", priority: 200 })];
    expect(selectLink(links, { country: "de", now: NOW })?.id).toBe("de");
    expect(selectLink(links, { country: "US", now: NOW })?.id).toBe("global");
    expect(selectLink(links, { now: NOW })?.id).toBe("global");
  });
  it("never picks a link for another country", () => {
    expect(selectLink([link({ region: "DE" })], { country: "US", now: NOW })).toBeNull();
  });
  it("picks the lowest priority number", () => {
    const links = [link({ id: "b", priority: 50 }), link({ id: "a", priority: 10 })];
    expect(selectLink(links, { now: NOW })?.id).toBe("a");
  });
  it("splits ties by weight", () => {
    const links = [link({ id: "a", weight: 75 }), link({ id: "b", weight: 25 })];
    expect(selectLink(links, { now: NOW, random: () => 0.1 })?.id).toBe("a");
    expect(selectLink(links, { now: NOW, random: () => 0.9 })?.id).toBe("b");
    // Defensive: rounding can leave the roll at the very end.
    expect(selectLink(links, { now: NOW, random: () => 1 })?.id).toBe("b");
  });
  it("treats all-zero or negative weights as 'first wins'", () => {
    const links = [link({ id: "a", weight: 0 }), link({ id: "b", weight: -5 })];
    expect(selectLink(links, { now: NOW, random: () => 0.9 })?.id).toBe("a");
  });
  it("uses Math.random and the current time by default", () => {
    expect(selectLink([link()])?.id).toBe("l1");
  });
  it("skips programs that forbid redirects", () => {
    const forbidden = link({ program: { ...link().program!, redirectPolicy: "forbidden" } });
    expect(selectLink([forbidden], { now: NOW })).toBeNull();
    const unknown = link({ program: { ...link().program!, redirectPolicy: "unknown" } });
    expect(selectLink([unknown], { now: NOW })?.id).toBe("l1");
  });
});

describe("resolveGoLink", () => {
  it("redirects to the affiliate link with the SubID", () => {
    const r = resolveGoLink(
      table([
        link({
          destinationUrl: "https://vendor.com/?x=1",
          program: {
            ...link().program!,
            linkFormat: { kind: "query_param", param: "via", value: "ar", subIdParam: "sid" },
          },
        }),
      ]),
      { articleSlug: "notion-review", placement: "verdict", now: NOW },
    );
    expect(r).toEqual({
      url: "https://vendor.com/?x=1&via=ar&sid=notion-review--verdict",
      linkId: "l1",
      programId: "p1",
      fallback: false,
      subId: "notion-review--verdict",
      experimentId: null,
    });
  });
  it("tags A/B variant clicks with the experiment and a variant SubID (FR-AFF-13)", () => {
    const links = [
      link({ id: "aaaaaaaa-1111-4000-8000-000000000000", experimentId: "exp1", weight: 50 }),
      link({ id: "bbbbbbbb-2222-4000-8000-000000000000", experimentId: "exp1", weight: 50 }),
    ];
    const a = resolveGoLink(table(links), {
      articleSlug: "notion-review",
      placement: "hero",
      now: NOW,
      random: () => 0.1,
    });
    const b = resolveGoLink(table(links), {
      articleSlug: "notion-review",
      placement: "hero",
      now: NOW,
      random: () => 0.9,
    });
    expect(a).toMatchObject({ linkId: links[0]!.id, experimentId: "exp1", subId: "notion-review--hero--vaaaaaa" });
    expect(b).toMatchObject({ linkId: links[1]!.id, experimentId: "exp1", subId: "notion-review--hero--vbbbbbb" });
    expect(new URL(a.url).searchParams.get("via")).toBe("aireview");
  });
  it("supports manual links with no program", () => {
    const r = resolveGoLink(table([link({ program: null, destinationUrl: "https://v.com/r/abc" })]), { now: NOW });
    expect(r).toMatchObject({ url: "https://v.com/r/abc", programId: null, fallback: false });
  });
  it("falls back to the vendor URL with UTM when no link is usable (FR-AFF-5)", () => {
    const r = resolveGoLink(table([link({ status: "paused" })]), { placement: "sticky_mobile", now: NOW });
    expect(r.fallback).toBe(true);
    expect(r.linkId).toBeNull();
    expect(r.url).toBe(
      "https://notion.so/?utm_source=ai-review.dev&utm_medium=referral&utm_campaign=notion&utm_content=sticky_mobile",
    );
  });
  it("wraps the vendor fallback in the catch-all network when configured (FR-AFF-5)", () => {
    const base = table([link({ status: "paused" })]);
    const sky = resolveGoLink(
      { ...base, catchAll: { network: "skimlinks", publisherId: "123X456" } },
      { articleSlug: "notion-review", placement: "hero", now: NOW },
    );
    expect(sky.fallback).toBe(true);
    const u = new URL(sky.url);
    expect(u.origin).toBe("https://go.skimresources.com");
    expect(u.searchParams.get("id")).toBe("123X456");
    expect(u.searchParams.get("xcust")).toBe("notion-review--hero");
    expect(u.searchParams.get("url")).toContain("https://notion.so/?utm_source=ai-review.dev");
    const sov = new URL(
      resolveGoLink({ ...base, catchAll: { network: "sovrn", publisherId: "key1" } }, { now: NOW }).url,
    );
    expect(sov.origin).toBe("https://redirect.viglink.com");
    expect(sov.searchParams.get("key")).toBe("key1");
    expect(sov.searchParams.get("cuid")).toBe("go--direct");
    expect(sov.searchParams.get("u")).toContain("utm_campaign=notion");
    // A usable direct link always wins over the catch-all.
    const direct = resolveGoLink(
      { ...table([link()]), catchAll: { network: "sovrn", publisherId: "k" } },
      { now: NOW },
    );
    expect(direct.fallback).toBe(false);
  });
  it("falls through a link with a broken URL to the next one, then to the vendor", () => {
    const broken = link({ id: "bad", priority: 1, destinationUrl: "ftp://nope" });
    const good = link({ id: "good", priority: 2 });
    expect(resolveGoLink(table([broken, good]), { now: NOW }).linkId).toBe("good");
    const r = resolveGoLink(table([broken]), { now: NOW });
    expect(r.fallback).toBe(true);
    expect(r.url).toContain("utm_campaign=notion");
    expect(r.url).not.toContain("utm_content");
  });
});

describe("ctaTarget", () => {
  const forbiddenProgram = {
    id: "amz",
    status: "active" as const,
    network: "amazon" as const,
    redirectPolicy: "forbidden" as const,
    linkFormat: { kind: "static_url" as const },
  };
  it("uses the go-link by default", () => {
    expect(ctaTarget(table([link()]), { now: NOW })).toEqual({ kind: "golink" });
    expect(ctaTarget(table([]))).toEqual({ kind: "golink" });
  });
  it("links directly when the best link's program forbids redirects (C-2)", () => {
    const amazon = link({ id: "amz", priority: 1, destinationUrl: "https://amzn.to/abc", program: forbiddenProgram });
    expect(ctaTarget(table([amazon]), { now: NOW })).toEqual({ kind: "direct", url: "https://amzn.to/abc" });
    expect(ctaTarget(table([amazon, link({ priority: 5 })]), { now: NOW })).toEqual({
      kind: "direct",
      url: "https://amzn.to/abc",
    });
  });
  it("keeps the go-link when a redirectable link outranks the forbidden one", () => {
    const amazon = link({ id: "amz", priority: 50, program: forbiddenProgram });
    expect(ctaTarget(table([amazon, link({ priority: 5 })]), { now: NOW })).toEqual({ kind: "golink" });
  });
  it("ignores ineligible forbidden links and sorts forbidden ones by priority", () => {
    const paused = link({ id: "a", status: "paused", program: forbiddenProgram });
    expect(ctaTarget(table([paused]), { now: NOW })).toEqual({ kind: "golink" });
    const first = link({ id: "x", priority: 3, destinationUrl: "https://amzn.to/x", program: forbiddenProgram });
    const second = link({ id: "y", priority: 1, destinationUrl: "https://amzn.to/y", program: forbiddenProgram });
    expect(ctaTarget(table([first, second]), { now: NOW })).toEqual({ kind: "direct", url: "https://amzn.to/y" });
  });
  it("falls back to the go-link if the forbidden link's URL is unusable", () => {
    const bad = link({ destinationUrl: "mailto:x@y.z", program: forbiddenProgram });
    expect(ctaTarget(table([bad]), { now: NOW })).toEqual({ kind: "golink" });
  });
  it("passes the SubID to direct links when the format supports it", () => {
    const withSid = link({
      destinationUrl: "https://shop.example/x",
      program: { ...forbiddenProgram, network: "awin", linkFormat: { kind: "network_link", network: "awin" } },
    });
    expect(ctaTarget(table([withSid]), { now: NOW, articleSlug: "a", placement: "b" })).toEqual({
      kind: "direct",
      url: "https://shop.example/x?clickref=a--b",
    });
    const noFormat = link({
      destinationUrl: "https://shop.example/y",
      program: { ...forbiddenProgram, linkFormat: null },
    });
    expect(ctaTarget(table([noFormat]), { now: NOW })).toEqual({ kind: "direct", url: "https://shop.example/y" });
  });
});
