import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkList, checkOpenApi, checkSearchLatency, percentile } from "./checks/api.ts";
import { checkCmsGate, checkCmsLogin } from "./checks/cms.ts";
import { checkGoRedirect, checkGoUnknown } from "./checks/golink.ts";
import { checkSecurityHeaders } from "./checks/headers.ts";
import { checkHreflang, checkMonetisation, checkSeoTags, checkStructuredData, reviewFacts } from "./checks/review.ts";
import { checkCertificate } from "./checks/tls.ts";
import { checkFeed, checkHealth, checkIndexablePage, checkIndexNow, checkRobots, checkSitemap } from "./checks/web.ts";
import type { CheckResult, FetchResult } from "./types.ts";

const REVIEW = readFileSync(new URL("./fixtures/review.html", import.meta.url), "utf8");
const URL_ = "https://ai-review.dev/reviews/acme-review";
const ORIGIN = "https://ai-review.dev";

const res = (
  body: string,
  init: { status?: number; headers?: Record<string, string>; url?: string; ms?: number } = {},
): FetchResult => ({
  url: init.url ?? URL_,
  status: init.status ?? 200,
  headers: new Headers(init.headers ?? {}),
  body,
  ms: init.ms ?? 50,
});
const byId = (rs: CheckResult[]) => Object.fromEntries(rs.map((r) => [r.id, r.status]));

describe("review page", () => {
  it("passes a well-formed review", () => {
    const all = [
      ...checkSeoTags(REVIEW, URL_, res(REVIEW)),
      ...checkStructuredData(REVIEW, URL_),
      ...checkMonetisation(REVIEW, URL_).results,
    ];
    expect(all.filter((r) => r.status !== "pass")).toEqual([]);
  });

  it("extracts go-links, og:image and alternates", () => {
    expect(checkMonetisation(REVIEW, URL_).goHrefs[0]).toBe("https://ai-review.dev/go/acme?p=verdict&a=acme-review");
    const facts = reviewFacts(REVIEW, URL_);
    expect(facts.ogImage).toBe("https://media.example.com/acme/og.webp");
    expect(facts.alternates.map((a) => a.hreflang)).toEqual(["en", "de", "x-default"]);
  });

  it("fails when the disclosure comes after the first CTA", () => {
    const html = REVIEW.replace(/<p class="rounded-md" role="note">[\s\S]*?<\/p>/, "").replace(
      "</main>",
      '<p role="note">Disclosure <a href="/affiliate-disclosure">x</a></p></main>',
    );
    expect(byId(checkMonetisation(html, URL_).results)["review.disclosure"]).toBe("fail");
  });

  it("does not take the footer policy link for the disclosure", () => {
    const html = REVIEW.replace(/<p class="rounded-md" role="note">[\s\S]*?<\/p>/, "");
    expect(byId(checkMonetisation(html, URL_).results)["review.disclosure"]).toBe("fail");
  });

  it("flags go-links without rel=sponsored", () => {
    const html = REVIEW.replace('rel="sponsored nofollow noopener"', 'rel="noopener"');
    expect(byId(checkMonetisation(html, URL_).results)["review.rel-sponsored"]).toBe("fail");
  });

  it("recognises German pages", () => {
    const html = REVIEW.replace(
      "Researched with AI assistance and reviewed by our editor.",
      "Mit KI-Unterstützung recherchiert.",
    )
      .replace(/Facts verified<!-- --> October 10, 2026/, "Fakten geprüft am 10. Oktober 2026")
      .replaceAll('href="/editorial-policy"', 'href="/de/editorial-policy"')
      .replaceAll('href="/affiliate-disclosure"', 'href="/de/affiliate-disclosure"')
      .replaceAll('href="/go/', 'href="/de/go/');
    const r = byId(checkMonetisation(html, "https://ai-review.dev/de/reviews/acme-test").results);
    expect(r).toMatchObject({
      "review.disclosure": "pass",
      "review.ai-disclosure": "pass",
      "review.verified-date": "pass",
    });
  });

  it("rejects fabricated ratings, missing breadcrumbs and broken JSON-LD", () => {
    const fake = REVIEW.replace(
      '"reviewRating"',
      '"aggregateRating":{"@type":"AggregateRating","ratingValue":4.6,"reviewCount":312},"reviewRating"',
    );
    expect(byId(checkStructuredData(fake, URL_))["review.rating-honest"]).toBe("fail");
    const noCrumbs = REVIEW.replace(
      /<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org","@type":"BreadcrumbList"[\s\S]*?<\/script>/,
      "",
    );
    expect(byId(checkStructuredData(noCrumbs, URL_))["review.breadcrumbs"]).toBe("fail");
    const broken = REVIEW.replace('"name":"Acme",', '"name":"Acme",,');
    expect(byId(checkStructuredData(broken, URL_))["review.jsonld"]).toBe("fail");
    expect(byId(checkStructuredData("<html></html>", URL_))["review.jsonld"]).toBe("fail");
  });

  it("handles @graph and a missing product review", () => {
    const graph = `<script type="application/ld+json">{"@graph":[{"@type":"SoftwareApplication","name":"A","offers":{"price":1}}]}</script>`;
    const r = checkStructuredData(graph, URL_);
    expect(r.find((x) => x.id === "review.jsonld")?.message).toContain("no Review");
    expect(byId(r)["review.faq"]).toBe("warn");
  });

  it("flags SEO tag problems", () => {
    const html = REVIEW.replace(/<title>[^<]*<\/title>/, "<title>Acme</title>")
      .replace('href="https://ai-review.dev/reviews/acme-review"/>', 'href="https://ai-review.dev/reviews/other"/>')
      .replace('<meta name="robots" content="index, follow"/>', '<meta name="robots" content="noindex"/>')
      .replace(/<meta name="description"[^>]*>/, "")
      .replace(/<meta name="twitter:card"[^>]*>/, "");
    expect(byId(checkSeoTags(html, URL_, res(html)))).toMatchObject({
      "review.title": "warn",
      "review.canonical": "fail",
      "review.indexable": "fail",
      "review.description": "fail",
      "review.social": "fail",
    });
  });
});

describe("hreflang", () => {
  const own = reviewFacts(REVIEW, URL_).alternates;
  it("passes reciprocal alternates", () => {
    const de = [{ hreflang: "en", href: URL_ }];
    expect(checkHreflang(URL_, own, new Map([["https://ai-review.dev/de/reviews/acme-test", de]])).status).toBe("pass");
  });
  it("fails without a link back or x-default", () => {
    expect(checkHreflang(URL_, own, new Map([["https://ai-review.dev/de/reviews/acme-test", []]])).message).toContain(
      "does not link back",
    );
    expect(
      checkHreflang(
        URL_,
        own.filter((a) => a.hreflang !== "x-default"),
        new Map(),
      ).message,
    ).toContain("x-default");
    expect(checkHreflang(URL_, [], new Map()).status).toBe("pass");
  });
});

describe("go-link", () => {
  const ok = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };
  it("accepts a 302 with SubID or UTM", () => {
    const sub = res("", {
      status: 302,
      headers: { ...ok, location: "https://acme.dev/?via=ai&sub1=acme-review--verdict" },
    });
    expect(checkGoRedirect(sub, ORIGIN, { local: false }).every((r) => r.status === "pass")).toBe(true);
    const utm = res("", { status: 302, headers: { ...ok, location: "https://acme.dev/?utm_source=ai-review.dev" } });
    expect(byId(checkGoRedirect(utm, ORIGIN, { local: false }))["golink.tracking"]).toBe("pass");
  });
  it("rejects caching, missing tracking and self-redirects", () => {
    const bad = res("", {
      status: 302,
      headers: { "cache-control": "public, max-age=60", location: "https://acme.dev/" },
    });
    expect(byId(checkGoRedirect(bad, ORIGIN, { local: false }))).toMatchObject({
      "golink.tracking": "fail",
      "golink.no-cache": "fail",
      "golink.noindex": "fail",
    });
    expect(
      checkGoRedirect(res("", { status: 302, headers: { location: "https://ai-review.dev/" } }), ORIGIN, {
        local: false,
      })[0]!.status,
    ).toBe("fail");
    expect(
      checkGoRedirect(res("", { status: 302, headers: { location: "/x" } }), ORIGIN, { local: false })[0]!.message,
    ).toContain("not absolute");
    expect(checkGoRedirect(res("", { status: 200 }), ORIGIN, { local: false })[0]!.status).toBe("fail");
  });
  it("expects 404 for unknown slugs", () => {
    expect(checkGoUnknown(res("", { status: 404 })).status).toBe("pass");
    expect(checkGoUnknown(res("", { status: 302 })).status).toBe("fail");
  });
});

describe("site plumbing", () => {
  it("parses robots.txt", () => {
    const good =
      "User-Agent: *\nAllow: /\nDisallow: /go/\nDisallow: /api/\n\nSitemap: https://ai-review.dev/sitemap.xml\n";
    expect(checkRobots(res(good), ORIGIN).every((r) => r.status === "pass")).toBe(true);
    const bad = "User-Agent: *\nDisallow: /\n\nSitemap: http://localhost:3000/sitemap.xml\n";
    expect(byId(checkRobots(res(bad), ORIGIN))).toMatchObject({
      "robots.allow": "fail",
      "robots.sitemap": "fail",
      "robots.go": "fail",
    });
  });

  it("parses sitemaps and flags foreign origins", () => {
    const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://ai-review.dev/sitemaps/reviews.xml</loc></sitemap></sitemapindex>`;
    expect(checkSitemap("s", res(index), "index", ORIGIN, { local: false }).locs).toEqual([
      "https://ai-review.dev/sitemaps/reviews.xml",
    ]);
    expect(checkSitemap("s", res(index), "urlset", ORIGIN, { local: false }).results[0]!.status).toBe("fail");
    const foreign = `<urlset><url><loc>http://localhost:3000/reviews/a</loc></url></urlset>`;
    expect(checkSitemap("s", res(foreign), "urlset", ORIGIN, { local: false }).results[0]!.status).toBe("fail");
    expect(checkSitemap("s", res(foreign), "urlset", ORIGIN, { local: true }).results[0]!.status).toBe("warn");
  });

  it("checks indexable pages", () => {
    expect(checkIndexablePage("p", URL_, res(REVIEW))[0]!.status).toBe("pass");
    expect(checkIndexablePage("p", `${URL_}/`, res(REVIEW))[0]!.status).toBe("pass");
    expect(checkIndexablePage("p", "https://ai-review.dev/other", res(REVIEW))[0]!.status).toBe("fail");
    expect(checkIndexablePage("p", URL_, res("", { status: 500 }))[0]!.status).toBe("fail");
  });

  it("parses feeds", () => {
    const rss = `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>AI Review</title><atom:link href="x" rel="self"/><item><title>A</title></item></channel></rss>`;
    expect(
      checkFeed("f", res(rss, { headers: { "content-type": "application/rss+xml" } }), { expectItems: true })[0]!
        .status,
    ).toBe("pass");
    const empty = rss.replace(/<item>.*<\/item>/, "");
    expect(
      checkFeed("f", res(empty, { headers: { "content-type": "application/rss+xml" } }), { expectItems: true })[0]!
        .status,
    ).toBe("fail");
    expect(checkFeed("f", res("<html/>"), { expectItems: false })[0]!.status).toBe("fail");
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>AI</title><link rel="self" href="x"/><entry/></feed>`;
    expect(
      checkFeed("f", res(atom, { headers: { "content-type": "application/atom+xml" } }), { expectItems: true })[0]!
        .message,
    ).toContain("atom");
  });

  it("checks health and IndexNow", () => {
    expect(checkHealth("h", res('{"status":"ok"}'), { slowMs: 1000 })[0]!.status).toBe("pass");
    expect(checkHealth("h", res('{"status":"ok"}', { ms: 3000 }), { slowMs: 1000 })[0]!.status).toBe("warn");
    expect(checkHealth("h", res('{"status":"degraded"}', { status: 503 }), { slowMs: 1000 })[0]!.status).toBe("fail");
    const key = "a".repeat(32);
    expect(byId(checkIndexNow(res("", { status: 404 }), { key, res: res(key) }))).toEqual({
      "indexnow.unknown": "pass",
      "indexnow.key": "pass",
    });
    expect(byId(checkIndexNow(res(key), { key, res: res("nope") }))).toEqual({
      "indexnow.unknown": "fail",
      "indexnow.key": "fail",
    });
  });
});

describe("headers", () => {
  const hardened = {
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  };
  it("passes hardened responses", () => {
    expect(
      checkSecurityHeaders("web", URL_, new Headers(hardened), { local: false }).every((r) => r.status === "pass"),
    ).toBe(true);
  });
  it("fails missing headers and relaxes HSTS locally", () => {
    const r = byId(checkSecurityHeaders("cms", URL_, new Headers({}), { local: true }));
    expect(r).toMatchObject({
      "headers.cms.hsts": "skip",
      "headers.cms.csp": "fail",
      "headers.cms.frame": "fail",
      "headers.cms.nosniff": "fail",
    });
    const api = byId(
      checkSecurityHeaders(
        "api",
        URL_,
        new Headers({ "x-frame-options": "SAMEORIGIN", "strict-transport-security": "max-age=60" }),
        { local: false },
      ),
    );
    expect(api).toMatchObject({
      "headers.api.frame": "pass",
      "headers.api.hsts": "warn",
      "headers.api.referrer": "warn",
    });
    expect(api["headers.api.csp"]).toBeUndefined();
  });
});

describe("cms, api, tls", () => {
  it("checks the CMS login and auth gate", () => {
    expect(byId(checkCmsLogin(res('<meta name="robots" content="noindex, nofollow"/>')))).toEqual({
      "cms.login": "pass",
      "cms.noindex": "pass",
    });
    expect(byId(checkCmsLogin(res("<html></html>")))["cms.noindex"]).toBe("fail");
    expect(checkCmsGate(res("", { status: 307, headers: { location: "/login" } })).status).toBe("pass");
    expect(checkCmsGate(res("dashboard")).status).toBe("fail");
  });

  it("validates the OpenAPI document and lists", () => {
    const doc = {
      openapi: "3.1.0",
      info: { version: "1.4.0" },
      paths: { "/v1/reviews": {}, "/v1/search": {}, "/v1/health": {} },
    };
    expect(checkOpenApi(res(JSON.stringify(doc))).status).toBe("pass");
    expect(checkOpenApi(res(JSON.stringify({ ...doc, openapi: "3.0.3" }))).status).toBe("fail");
    expect(checkOpenApi(res(JSON.stringify({ ...doc, paths: {} }))).message).toContain("/v1/reviews");
    expect(checkList("l", res('{"data":[1]}'), { expectItems: true }).result.status).toBe("pass");
    expect(checkList("l", res('{"data":[]}'), { expectItems: true }).result.status).toBe("fail");
    expect(checkList("l", res("{}"), { expectItems: false }).result.status).toBe("fail");
  });

  it("computes server-side search p95", () => {
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    const samples = Array.from({ length: 20 }, () => 400);
    expect(checkSearchLatency(samples, [250, 260, 270], { local: false }).status).toBe("pass");
    expect(checkSearchLatency(samples, [10], { local: false }).status).toBe("fail");
    expect(checkSearchLatency(samples, [10], { local: true }).status).toBe("warn");
    expect(checkSearchLatency(samples, [10], { local: false, failures: 2 }).status).toBe("fail");
  });

  it("grades certificate expiry", () => {
    expect(checkCertificate("a", 60).status).toBe("pass");
    expect(checkCertificate("a", 10).status).toBe("warn");
    expect(checkCertificate("a", 3).status).toBe("fail");
  });
});
