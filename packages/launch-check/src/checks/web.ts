import { canonicalOf, metaContent } from "../html.ts";
import { result, type CheckResult, type FetchResult } from "../types.ts";
import { parseFeed, sitemapKind, sitemapLocs } from "../xml.ts";

const SEO = "FR-WEB-4";

/** Health endpoint returns 200 with `status: ok` (FR-WEB-2 availability, NFR uptime). */
export function checkHealth(id: string, res: FetchResult, opts: { slowMs: number }): CheckResult[] {
  const target = res.url;
  let status: string | undefined;
  try {
    status = (JSON.parse(res.body) as { status?: string }).status;
  } catch {
    status = undefined;
  }
  if (res.status !== 200 || status !== "ok") {
    return [
      result(id, "fail", `HTTP ${res.status}${status ? `, status ${status}` : ""}`, {
        ref: "NFR availability",
        target,
      }),
    ];
  }
  const ms = Math.round(res.ms);
  return [
    result(id, ms > opts.slowMs ? "warn" : "pass", ms > opts.slowMs ? `ok but slow (${ms} ms)` : `ok (${ms} ms)`, {
      ref: "NFR availability",
      target,
    }),
  ];
}

/** robots.txt allows crawling, points at the sitemap and keeps `/go/` out of the index. */
export function checkRobots(
  res: FetchResult,
  siteOrigin: string,
  opts: { local: boolean } = { local: false },
): CheckResult[] {
  const target = res.url;
  if (res.status !== 200) return [result("robots", "fail", `HTTP ${res.status}`, { ref: SEO, target })];
  const lines = res.body.split(/\r?\n/).map((l) => l.trim());
  // Rules of the `User-Agent: *` group.
  const rules: string[] = [];
  let inStar = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") inStar = value === "*";
    else if (inStar && (key === "allow" || key === "disallow")) rules.push(`${key}:${value}`);
  }
  const out: CheckResult[] = [];
  const blocksAll = rules.includes("disallow:/");
  out.push(
    result(
      "robots.allow",
      blocksAll ? "fail" : "pass",
      blocksAll ? "User-Agent * is disallowed from /" : "site crawlable",
      { ref: SEO, target },
    ),
  );
  const sitemaps = lines.filter((l) => /^sitemap:/i.test(l)).map((l) => l.slice(l.indexOf(":") + 1).trim());
  const expected = `${siteOrigin}/sitemap.xml`;
  // Locally the app may advertise NEXT_PUBLIC_SITE_URL on another port: only the path must match.
  const localMatch = opts.local && sitemaps.some((s) => URL.canParse(s) && new URL(s).pathname === "/sitemap.xml");
  out.push(
    sitemaps.includes(expected)
      ? result("robots.sitemap", "pass", expected, { ref: SEO, target })
      : localMatch
        ? result("robots.sitemap", "warn", `Sitemap is ${sitemaps.join(", ")} (origin differs from ${siteOrigin})`, {
            ref: SEO,
            target,
          })
        : result(
            "robots.sitemap",
            "fail",
            sitemaps.length ? `Sitemap points at ${sitemaps.join(", ")}, expected ${expected}` : "no Sitemap line",
            { ref: SEO, target },
          ),
  );
  const goBlocked = rules.some((r) => r === "disallow:/go/" || r === "disallow:/go");
  out.push(
    result("robots.go", goBlocked ? "pass" : "fail", goBlocked ? "Disallow: /go/" : "/go/ is not disallowed", {
      ref: "FR-AFF-6",
      target,
    }),
  );
  return out;
}

/** Sitemap document parses; every `<loc>` sits on the site's origin. */
export function checkSitemap(
  id: string,
  res: FetchResult,
  expect: "index" | "urlset",
  siteOrigin: string,
  opts: { local: boolean },
): { results: CheckResult[]; locs: string[] } {
  const target = res.url;
  if (res.status !== 200)
    return { results: [result(id, "fail", `HTTP ${res.status}`, { ref: SEO, target })], locs: [] };
  const kind = sitemapKind(res.body);
  if (kind !== expect)
    return {
      results: [
        result(id, "fail", `expected a sitemap ${expect}, got ${kind ?? "no sitemap XML"}`, { ref: SEO, target }),
      ],
      locs: [],
    };
  const locs = sitemapLocs(res.body);
  const foreign = locs.filter((l) => {
    try {
      return new URL(l).origin !== siteOrigin;
    } catch {
      return true;
    }
  });
  if (foreign.length) {
    return {
      results: [
        result(id, opts.local ? "warn" : "fail", `${foreign.length} URL(s) not on ${siteOrigin}, e.g. ${foreign[0]}`, {
          ref: SEO,
          target,
        }),
      ],
      locs,
    };
  }
  return {
    results: [result(id, "pass", `${locs.length} entr${locs.length === 1 ? "y" : "ies"}`, { ref: SEO, target })],
    locs,
  };
}

/** An indexable page: 200, self-canonical, not noindex. */
export function checkIndexablePage(id: string, requested: string, res: FetchResult): CheckResult[] {
  const target = requested;
  if (res.status !== 200) return [result(id, "fail", `HTTP ${res.status}`, { ref: SEO, target })];
  const robots = metaContent(res.body, "robots") ?? res.headers.get("x-robots-tag") ?? "";
  if (/noindex/i.test(robots))
    return [result(id, "fail", `listed in sitemap but robots says "${robots}"`, { ref: SEO, target })];
  const canonical = canonicalOf(res.body);
  if (!canonical) return [result(id, "fail", "no canonical link", { ref: SEO, target })];
  if (normalizeUrl(canonical, requested) !== normalizeUrl(requested, requested)) {
    return [result(id, "fail", `canonical points at ${canonical}`, { ref: SEO, target })];
  }
  return [result(id, "pass", "200, self-canonical", { ref: SEO, target })];
}

/** Compares URLs ignoring a trailing slash (except the root) and the fragment. */
export function normalizeUrl(url: string, base: string): string {
  try {
    const u = new URL(url, base);
    u.hash = "";
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return url;
  }
}

/** RSS/Atom feed parses and lists items once reviews exist (FR-WEB-4). */
export function checkFeed(id: string, res: FetchResult, opts: { expectItems: boolean }): CheckResult[] {
  const target = res.url;
  if (res.status !== 200) return [result(id, "fail", `HTTP ${res.status}`, { ref: SEO, target })];
  const type = res.headers.get("content-type") ?? "";
  const feed = parseFeed(res.body);
  if (!feed) return [result(id, "fail", "not an RSS or Atom document", { ref: SEO, target })];
  if (!/xml/i.test(type))
    return [result(id, "warn", `${feed.kind} served as ${type || "no content-type"}`, { ref: SEO, target })];
  if (!feed.title) return [result(id, "fail", "feed has no title", { ref: SEO, target })];
  if (opts.expectItems && feed.items === 0)
    return [result(id, "fail", "feed has no items but reviews are published", { ref: SEO, target })];
  return [
    result(
      id,
      feed.selfLink ? "pass" : "warn",
      `${feed.kind}, ${feed.items} item(s)${feed.selfLink ? "" : ", no self link"}`,
      { ref: SEO, target },
    ),
  ];
}

/** IndexNow key file: the real key is served verbatim; a wrong key is a 404 (FR-WEB-4). */
export function checkIndexNow(wrong: FetchResult, real?: { key: string; res: FetchResult }): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(
    wrong.status === 404
      ? result("indexnow.unknown", "pass", "unknown key → 404", { ref: SEO, target: wrong.url })
      : result("indexnow.unknown", "fail", `unknown key returned HTTP ${wrong.status}`, {
          ref: SEO,
          target: wrong.url,
        }),
  );
  if (!real) out.push(result("indexnow.key", "skip", "pass --indexnow-key to verify the key file", { ref: SEO }));
  else if (real.res.status === 200 && real.res.body.trim() === real.key)
    out.push(result("indexnow.key", "pass", "key file served", { ref: SEO, target: real.res.url }));
  else
    out.push(
      result("indexnow.key", "fail", `HTTP ${real.res.status}, body does not match the key`, {
        ref: SEO,
        target: real.res.url,
      }),
    );
  return out;
}
