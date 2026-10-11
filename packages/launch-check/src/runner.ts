import { checkList, checkOpenApi, checkSearchLatency } from "./checks/api.ts";
import { checkCmsGate, checkCmsLogin } from "./checks/cms.ts";
import { checkGoRedirect, checkGoUnknown } from "./checks/golink.ts";
import { checkSecurityHeaders } from "./checks/headers.ts";
import {
  checkHreflang,
  checkMonetisation,
  checkOgImage,
  checkSeoTags,
  checkStructuredData,
  reviewFacts,
} from "./checks/review.ts";
import { certificateDaysLeft, checkCertificate } from "./checks/tls.ts";
import { checkFeed, checkHealth, checkIndexablePage, checkIndexNow, checkRobots, checkSitemap } from "./checks/web.ts";
import { hreflangAlternates } from "./html.ts";
import { createFetcher, type Fetcher } from "./http.ts";
import { result, type CheckResult, type Options } from "./types.ts";

export type Deps = { fetch: Fetcher; certDaysLeft: (host: string) => Promise<number> };

const trimSlash = (u: string) => u.replace(/\/+$/, "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Picks up to `n` URLs, alternating between locales (`/de/...` vs unprefixed) so both get covered. */
export function pickAcrossLocales(urls: string[], n: number): string[] {
  const groups = new Map<string, string[]>();
  for (const u of urls) {
    const locale = new URL(u).pathname.match(/^\/([a-z]{2})\//)?.[1] ?? "en";
    groups.set(locale, [...(groups.get(locale) ?? []), u]);
  }
  const lists = [...groups.values()];
  const out: string[] = [];
  for (let i = 0; out.length < n && lists.some((l) => l.length > i); i++) {
    for (const l of lists) if (l[i] && out.length < n) out.push(l[i]!);
  }
  return out;
}

export async function runChecks(
  opts: Options,
  deps: Deps = { fetch: createFetcher(4), certDaysLeft: certificateDaysLeft },
): Promise<CheckResult[]> {
  const site = trimSlash(opts.site);
  const siteOrigin = new URL(site).origin;
  const api = opts.api ? trimSlash(opts.api) : undefined;
  const cms = opts.cms ? trimSlash(opts.cms) : undefined;
  const full = opts.mode === "full";
  const { fetch } = deps;
  const out: CheckResult[] = [];

  /** Locally the app may advertise NEXT_PUBLIC_SITE_URL on another port; fetch from --site instead. */
  const fetchable = (u: string) => {
    if (!opts.local) return u;
    const parsed = new URL(u);
    return parsed.origin === siteOrigin ? u : `${siteOrigin}${parsed.pathname}${parsed.search}`;
  };
  /** Runs one step; an exception becomes a failed check instead of aborting the run. */
  const step = async (id: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      out.push(result(id, "fail", errorText(error)));
    }
  };

  // Health (NFR availability, FR-WEB-2).
  await Promise.all([
    step("health.web", async () => {
      out.push(...checkHealth("health.web", await fetch(`${site}/api/health`), { slowMs: 2000 }));
    }),
    api &&
      step("health.api", async () => {
        out.push(...checkHealth("health.api", await fetch(`${api}/v1/health`), { slowMs: 2000 }));
      }),
    cms &&
      step("cms.login", async () => {
        const login = await fetch(`${cms}/login`);
        out.push(...checkCmsLogin(login));
        if (full) out.push(...checkSecurityHeaders("cms", login.url, login.headers, opts));
        out.push(checkCmsGate(await fetch(`${cms}/`, { redirect: "manual" })));
      }),
  ]);

  // Sitemaps (FR-WEB-4). Quick mode only needs the review URLs.
  let reviewUrls: string[] = [];
  const otherUrls: string[] = [];
  const allLocs: string[] = [];
  await step("sitemap.index", async () => {
    const index = checkSitemap("sitemap.index", await fetch(`${site}/sitemap.xml`), "index", siteOrigin, opts);
    if (full || index.results.some((r) => r.status === "fail")) out.push(...index.results);
    const isReviews = (loc: string) => /review/i.test(new URL(loc).pathname);
    const children = full ? index.locs : index.locs.filter(isReviews);
    await Promise.all(
      children.map((loc) =>
        step(`sitemap ${loc}`, async () => {
          const id = `sitemap.${new URL(loc).pathname
            .split("/")
            .pop()
            ?.replace(/\.xml$/, "")}`;
          const child = checkSitemap(id, await fetch(fetchable(loc)), "urlset", siteOrigin, opts);
          if (full || child.results.some((r) => r.status === "fail")) out.push(...child.results);
          allLocs.push(...child.locs);
          if (isReviews(loc)) reviewUrls.push(...child.locs);
          else otherUrls.push(...child.locs);
        }),
      ),
    );
  });
  reviewUrls = pickAcrossLocales(reviewUrls, full ? opts.maxReviews : 1);
  if (reviewUrls.length === 0) out.push(result("review.sample", full ? "warn" : "skip", "no reviews in the sitemap"));

  if (full) {
    await step("headers.web", async () => {
      const home = await fetch(`${site}/`);
      out.push(...checkSecurityHeaders("web", home.url, home.headers, opts));
    });
    await step("robots", async () => {
      out.push(...checkRobots(await fetch(`${site}/robots.txt`), siteOrigin, opts));
    });
    // A spread of non-review pages: first entries of each sitemap are the hubs and policies.
    const sample = pickAcrossLocales(otherUrls, 8);
    await Promise.all(
      sample.map((u) =>
        step(`page ${u}`, async () => {
          out.push(...checkIndexablePage(`page${new URL(u).pathname}`, u, await fetch(fetchable(u))));
        }),
      ),
    );
    const locales = new Set(allLocs.map((u) => new URL(u).pathname.match(/^\/([a-z]{2})(?:\/|$)/)?.[1] ?? "en"));
    for (const locale of locales) {
      await step(`feed.${locale}`, async () => {
        const path = locale === "en" ? "/feed.xml" : `/${locale}/feed.xml`;
        const hasReviews = reviewUrls.some(
          (u) => (new URL(u).pathname.match(/^\/([a-z]{2})\//)?.[1] ?? "en") === locale,
        );
        out.push(...checkFeed(`feed.${locale}`, await fetch(`${site}${path}`), { expectItems: hasReviews }));
      });
    }
    await step("indexnow", async () => {
      const wrong = await fetch(`${site}/${"0".repeat(32)}.txt`);
      const real = opts.indexNowKey
        ? { key: opts.indexNowKey, res: await fetch(`${site}/${opts.indexNowKey}.txt`) }
        : undefined;
      out.push(...checkIndexNow(wrong, real));
    });
  }

  // Review pages (FR-CON-9, FR-AFF-14, FR-CON-10, FR-WEB-6) and the go-link contract (FR-AFF-6).
  let goHref: string | undefined;
  const ogImages = new Set<string>();
  for (const url of reviewUrls) {
    await step(`review ${url}`, async () => {
      const res = await fetch(fetchable(url));
      if (res.status !== 200) {
        out.push(result("review.status", "fail", `HTTP ${res.status}`, { ref: "FR-WEB-1", target: url }));
        return;
      }
      const html = res.body;
      const money = checkMonetisation(html, url);
      out.push(...money.results);
      goHref ??= money.goHrefs[0];
      if (!full) return;
      out.push(...checkSeoTags(html, url, res), ...checkStructuredData(html, url));
      const facts = reviewFacts(html, url);
      if (facts.ogImage && !ogImages.has(facts.ogImage)) {
        ogImages.add(facts.ogImage);
        out.push(checkOgImage(await fetch(facts.ogImage)));
      }
      const others = new Map<string, { hreflang: string; href: string }[] | null>();
      for (const alt of facts.alternates) {
        if (
          alt.hreflang === "x-default" ||
          new URL(alt.href).toString() === new URL(url).toString() ||
          others.has(alt.href)
        )
          continue;
        try {
          const r = await fetch(fetchable(alt.href));
          others.set(alt.href, r.status === 200 ? hreflangAlternates(r.body) : null);
        } catch {
          others.set(alt.href, null);
        }
      }
      out.push(checkHreflang(url, facts.alternates, others));
    });
  }

  await step("golink", async () => {
    if (!goHref) {
      if (reviewUrls.length)
        out.push(result("golink.redirect", "warn", "no go-link found on the sampled reviews", { ref: "FR-AFF-6" }));
    } else {
      out.push(...checkGoRedirect(await fetch(fetchable(goHref), { redirect: "manual" }), siteOrigin, opts));
    }
    if (full)
      out.push(
        checkGoUnknown(
          await fetch(`${site}/go/launch-check-missing-${Date.now().toString(36)}`, { redirect: "manual" }),
        ),
      );
  });

  // Public API (FR-API-1/2, FR-WEB-7).
  if (api && full) {
    await step("headers.api", async () => {
      const h = await fetch(`${api}/v1/health`);
      out.push(...checkSecurityHeaders("api", h.url, h.headers, opts));
    });
    await step("api.openapi", async () => {
      out.push(checkOpenApi(await fetch(`${api}/openapi.json`)));
    });
    let query = "review";
    await step("api.reviews", async () => {
      const list = checkList("api.reviews", await fetch(`${api}/v1/reviews?limit=5`), {
        expectItems: reviewUrls.length > 0,
      });
      out.push(list.result);
      const first = list.data[0] as { title?: string } | undefined;
      query = first?.title?.split(/\s+/)[0] ?? query;
      out.push(
        checkList("api.reviews-de", await fetch(`${api}/v1/reviews?limit=5&locale=de`), { expectItems: false }).result,
      );
    });
    await step("api.search-p95", async () => {
      const baseline: number[] = [];
      for (let i = 0; i < 5; i++) baseline.push((await fetch(`${api}/v1/health`)).ms);
      const samples: number[] = [];
      let failures = 0;
      for (let i = 0; i < 20; i++) {
        // A unique, ignored parameter bypasses the CDN cache so the database search is measured.
        const r = await fetch(
          `${api}/v1/search?q=${encodeURIComponent(query)}&limit=10&lc=${Date.now().toString(36)}${i}`,
        );
        if (r.status === 200) samples.push(r.ms);
        else failures++;
      }
      out.push(checkSearchLatency(samples, baseline, { local: opts.local, failures }));
    });
  }

  // Certificates (non-local only).
  if (full && !opts.local) {
    const hosts = [...new Set([site, api, cms].filter((u): u is string => !!u).map((u) => new URL(u).hostname))];
    await Promise.all(
      hosts.map((host) =>
        step(`tls.${host}`, async () => {
          out.push(checkCertificate(host, await deps.certDaysLeft(host)));
        }),
      ),
    );
  }
  return out;
}
