import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Fetcher } from "./http.ts";
import { formatMarkdown, formatTable } from "./report.ts";
import { pickAcrossLocales, runChecks } from "./runner.ts";
import type { FetchResult, Options } from "./types.ts";

const REVIEW = readFileSync(new URL("./fixtures/review.html", import.meta.url), "utf8");

/** A fake deployment. `advertised` is the origin the app writes into sitemaps and canonicals. */
const HARDENED = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000",
};

function fakeSite(advertised: string, served: string, cms = "http://cms.test") {
  const reviewHtml = REVIEW.replaceAll("https://ai-review.dev", advertised).replace(/<link rel="alternate"[^>]*>/g, "");
  const routes: Record<string, { status?: number; body?: string; headers?: Record<string, string> }> = {
    "/api/health": { body: '{"status":"ok"}' },
    "/v1/health": { body: '{"status":"ok"}' },
    "/": { body: "<html></html>" },
    "/robots.txt": { body: `User-Agent: *\nAllow: /\nDisallow: /go/\nSitemap: ${advertised}/sitemap.xml\n` },
    "/sitemap.xml": {
      body: `<sitemapindex><sitemap><loc>${advertised}/sitemaps/reviews.xml</loc></sitemap><sitemap><loc>${advertised}/sitemaps/pages.xml</loc></sitemap></sitemapindex>`,
    },
    "/sitemaps/reviews.xml": { body: `<urlset><url><loc>${advertised}/reviews/acme-review</loc></url></urlset>` },
    "/sitemaps/pages.xml": { body: `<urlset><url><loc>${advertised}/reviews/acme-review</loc></url></urlset>` },
    "/reviews/acme-review": { body: reviewHtml },
    "/feed.xml": {
      body: `<rss><channel><title>x</title><item/></channel></rss>`,
      headers: { "content-type": "application/rss+xml" },
    },
    "/go/acme": {
      status: 302,
      headers: {
        location: "https://acme.dev/?utm_source=ai-review.dev",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    },
    "/openapi.json": {
      body: JSON.stringify({ openapi: "3.1.0", paths: { "/v1/reviews": {}, "/v1/search": {}, "/v1/health": {} } }),
    },
    "/v1/reviews": { body: '{"data":[{"title":"Acme Review"}]}' },
    "/v1/search": { body: '{"data":[]}' },
  };
  const cmsRoutes: typeof routes = {
    "/login": { body: '<meta name="robots" content="noindex"/>' },
    "/": { status: 307, headers: { location: "/login" } },
  };
  const requested: string[] = [];
  const fetch: Fetcher = async (url) => {
    requested.push(url);
    const u = new URL(url);
    const route = u.origin === served ? routes[u.pathname] : u.origin === cms ? cmsRoutes[u.pathname] : undefined;
    if (u.hostname === "media.example.com")
      return {
        url,
        status: 200,
        headers: new Headers({ "content-type": "image/webp" }),
        body: "x",
        ms: 5,
      } satisfies FetchResult;
    return {
      url,
      status: route ? (route.status ?? 200) : 404,
      headers: new Headers({ ...HARDENED, ...route?.headers }),
      body: route?.body ?? "",
      ms: 5,
    };
  };
  return { fetch, requested };
}

const opts = (o: Partial<Options>): Options => ({
  site: "http://localhost:4000",
  mode: "full",
  local: true,
  maxReviews: 5,
  ...o,
});

describe("runChecks", () => {
  it("runs a full local check, fetching advertised URLs from --site", async () => {
    const { fetch, requested } = fakeSite("http://localhost:3000", "http://localhost:4000");
    const results = await runChecks(opts({ api: "http://localhost:4000", cms: "http://cms.test" }), {
      fetch,
      certDaysLeft: async () => 90,
    });
    expect(requested.every((u) => !u.startsWith("http://localhost:3000"))).toBe(true);
    const fails = results.filter((r) => r.status === "fail");
    expect(fails).toEqual([]);
    expect(results.find((r) => r.id === "golink.redirect")?.status).toBe("pass");
    expect(results.some((r) => r.id.startsWith("tls."))).toBe(false);
    expect(formatTable(results)).toContain("0 failed");
  });

  it("quick mode fetches only health, CMS, one review and the go-link", async () => {
    const { fetch, requested } = fakeSite("https://ai-review.dev", "https://ai-review.dev");
    const results = await runChecks(
      opts({ site: "https://ai-review.dev", api: "https://ai-review.dev", local: false, mode: "quick" }),
      { fetch, certDaysLeft: async () => 90 },
    );
    expect(requested.map((u) => new URL(u).pathname).sort()).toEqual([
      "/api/health",
      "/go/acme",
      "/reviews/acme-review",
      "/sitemap.xml",
      "/sitemaps/reviews.xml",
      "/v1/health",
    ]);
    expect(results.filter((r) => r.status === "fail")).toEqual([]);
  });

  it("reports thrown errors as failures and renders markdown", async () => {
    const fetch: Fetcher = async () => {
      throw new Error("ECONNREFUSED");
    };
    const o = opts({ mode: "quick" });
    const results = await runChecks(o, { fetch, certDaysLeft: async () => 90 });
    expect(results.find((r) => r.id === "health.web")).toMatchObject({ status: "fail", message: "ECONNREFUSED" });
    expect(formatMarkdown(results, o)).toContain("| fail | `health.web` |");
  });

  it("checks certificates in production full runs", async () => {
    const { fetch } = fakeSite("https://ai-review.dev", "https://ai-review.dev");
    const results = await runChecks(opts({ site: "https://ai-review.dev", local: false }), {
      fetch,
      certDaysLeft: async () => 3,
    });
    expect(results.find((r) => r.id === "tls.ai-review.dev")?.status).toBe("fail");
  });
});

describe("pickAcrossLocales", () => {
  it("alternates locales", () => {
    const urls = [
      "https://x.dev/reviews/a",
      "https://x.dev/reviews/b",
      "https://x.dev/de/reviews/a",
      "https://x.dev/de/reviews/b",
    ];
    expect(pickAcrossLocales(urls, 3)).toEqual([
      "https://x.dev/reviews/a",
      "https://x.dev/de/reviews/a",
      "https://x.dev/reviews/b",
    ]);
  });
});
