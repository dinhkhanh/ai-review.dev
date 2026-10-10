import { buildTrackedUrl, type LinkFormat, type Network } from "@repo/affiliate";
import {
  affiliateLinks,
  affiliatePrograms,
  and,
  articles,
  eq,
  goSlugs,
  inArray,
  ne,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { getDomain } from "tldts";
import { notify } from "./notifications";
import { pathsForArticle, publishEnvFromProcess, requestRevalidation } from "./publishing";
import { getSetting } from "./settings";
import { assertPublicHttpUrl } from "./url";

export type LinkProblemCode =
  | "http_error"
  | "redirect_loop"
  | "too_many_redirects"
  | "domain_changed"
  | "network_error"
  | "blocked_host"
  | "bot_protection"
  | "missing_tracking";

export interface LinkProblem {
  code: LinkProblemCode;
  detail: string;
  /** Fatal problems count towards auto-pausing; warnings are only recorded. */
  fatal: boolean;
}

export interface LinkCheckResult {
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  hops: string[];
  problems: LinkProblem[];
}

const MAX_HOPS = 10;
const UA = "Mozilla/5.0 (compatible; AIReviewLinkCheck/1.0; +https://ai-review.dev/editorial-policy)";

/** "notion.so" ~ "notion.com": same brand label, different TLD (common after rebrands). */
function sameBrand(a: string, b: string) {
  const label = (d: string) => d.split(".")[0];
  return a === b || label(a) === label(b);
}

async function request(fetchImpl: typeof fetch, url: string, method: "HEAD" | "GET", timeoutMs: number) {
  const res = await fetchImpl(url, {
    method,
    redirect: "manual",
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Don't download bodies.
  await res.body?.cancel().catch(() => {});
  return res;
}

/**
 * Follows an affiliate link hop by hop (FR-AFF-10): HEAD first, GET when the server refuses HEAD;
 * every hop passes the SSRF guard (NFR-7). Flags 4xx/5xx, loops, more than 10 redirects, a landing
 * domain other than the product's, and a tracking parameter that disappeared (warning only: some
 * vendors strip it after setting their cookie). 403/429 at the landing page usually mean bot
 * protection, so they are warnings rather than failures.
 */
export async function checkLink(
  url: string,
  opts: {
    fetch?: typeof fetch;
    productDomain?: string | null;
    linkFormat?: LinkFormat | null;
    timeoutMs?: number;
  } = {},
): Promise<LinkCheckResult> {
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const hops: string[] = [];
  const problems: LinkProblem[] = [];
  const seen = new Set<string>();
  let current = url;
  let status: number | null = null;

  for (let hop = 0; ; hop++) {
    if (hop > MAX_HOPS) {
      problems.push({ code: "too_many_redirects", detail: `More than ${MAX_HOPS} redirects`, fatal: true });
      return { ok: false, status, finalUrl: current, hops, problems };
    }
    try {
      assertPublicHttpUrl(current);
    } catch {
      problems.push({ code: "blocked_host", detail: `Redirects to a non-public host: ${current}`, fatal: true });
      return { ok: false, status, finalUrl: current, hops, problems };
    }
    seen.add(current);
    hops.push(current);
    let res: Response;
    try {
      res = await request(fetchImpl, current, "HEAD", timeoutMs);
      if (res.status >= 400) {
        res = await request(fetchImpl, current, "GET", timeoutMs);
      }
    } catch (error) {
      problems.push({ code: "network_error", detail: String(error).slice(0, 200), fatal: true });
      return { ok: false, status: null, finalUrl: current, hops, problems };
    }
    status = res.status;
    const location = res.headers.get("location");
    if (status >= 300 && status < 400 && location) {
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        problems.push({ code: "http_error", detail: `Invalid redirect target "${location}"`, fatal: true });
        return { ok: false, status, finalUrl: current, hops, problems };
      }
      if (seen.has(next)) {
        problems.push({ code: "redirect_loop", detail: `Loops back to ${next}`, fatal: true });
        return { ok: false, status, finalUrl: next, hops, problems };
      }
      current = next;
      continue;
    }
    break;
  }

  if (status === 403 || status === 429) {
    problems.push({
      code: "bot_protection",
      detail: `Landing page answered ${status} (likely bot protection)`,
      fatal: false,
    });
  } else if (status !== null && status >= 400) {
    problems.push({ code: "http_error", detail: `Landing page answered HTTP ${status}`, fatal: true });
  }
  const finalHost = new URL(current).hostname;
  const finalDomain = getDomain(finalHost) ?? finalHost;
  if (opts.productDomain && !sameBrand(finalDomain, opts.productDomain.toLowerCase())) {
    problems.push({
      code: "domain_changed",
      detail: `Lands on ${finalDomain}, expected ${opts.productDomain}`,
      fatal: true,
    });
  }
  if (opts.linkFormat?.kind === "query_param" && !new URL(current).searchParams.has(opts.linkFormat.param)) {
    problems.push({
      code: "missing_tracking",
      detail: `Tracking parameter "${opts.linkFormat.param}" is gone at the landing page`,
      fatal: false,
    });
  }
  return { ok: !problems.some((p) => p.fatal), status, finalUrl: current, hops, problems };
}

/** Deletes cached go-link tables in Upstash (REST API) so pauses apply at once (FR-AFF-8). */
export async function invalidateGoLinkCache(
  slugs: string[],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || slugs.length === 0) return false;
  try {
    const path = slugs.map((s) => encodeURIComponent(`golink:v1:${s}`)).join("/");
    const res = await fetchImpl(`${url.replace(/\/$/, "")}/del/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function summarize(result: LinkCheckResult): string {
  const head = result.ok ? "OK" : "FAILED";
  const parts = [`${head}: HTTP ${result.status ?? "—"}, ${Math.max(0, result.hops.length - 1)} redirects`];
  for (const p of result.problems) parts.push(`${p.fatal ? "✖" : "⚠"} ${p.detail}`);
  return parts.join(" · ").slice(0, 1000);
}

export interface LinkHealthRunOptions {
  fetch?: typeof fetch;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Check only these links (any status), e.g. the CMS "Check now" button. */
  linkIds?: string[];
  concurrency?: number;
}

/**
 * Daily link health run (FR-AFF-10): checks active and pending links, records the outcome and
 * pauses a link as `broken` after `linkHealth.policy.failuresBeforePause` consecutive failures,
 * notifying the admin. A broken link that passes again stays broken until an admin re-activates it.
 */
export async function runLinkHealthChecks(db: DbOrTx, opts: LinkHealthRunOptions = {}) {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetch ?? fetch;
  const policy = (await getSetting(db, "linkHealth.policy")) ?? { enabled: true, failuresBeforePause: 2 };
  if (!policy.enabled && !opts.linkIds) return { checked: 0, failed: 0, paused: [] as string[], skipped: true };

  const rows = await db
    .select({
      link: affiliateLinks,
      productName: products.name,
      productDomain: products.domain,
      linkFormat: affiliatePrograms.linkFormat,
      network: affiliatePrograms.network,
    })
    .from(affiliateLinks)
    .innerJoin(products, eq(products.id, affiliateLinks.productId))
    .leftJoin(affiliatePrograms, eq(affiliatePrograms.id, affiliateLinks.programId))
    .where(
      opts.linkIds?.length
        ? inArray(affiliateLinks.id, opts.linkIds)
        : inArray(affiliateLinks.status, ["active", "pending"]),
    );

  const paused: string[] = [];
  const affectedProducts = new Set<string>();
  let failed = 0;
  let next = 0;
  const day = now.toISOString().slice(0, 10);

  async function checkOne(row: (typeof rows)[number]) {
    const { link } = row;
    let target = link.destinationUrl;
    try {
      // No SubID: health checks must not look like page clicks in network reports.
      target = buildTrackedUrl(link.destinationUrl, row.linkFormat ?? null, {
        network: (row.network as Network) ?? null,
      });
    } catch {
      // Unbuildable URL: check the raw destination, which fails the same way.
    }
    const result = await checkLink(target, {
      fetch: fetchImpl,
      productDomain: row.productDomain,
      linkFormat: row.linkFormat ?? null,
    });
    const failures = result.ok ? 0 : link.healthFailures + 1;
    const pause = !result.ok && failures >= policy.failuresBeforePause && link.status !== "broken";
    let detail = summarize(result);
    if (result.ok && link.status === "broken") detail = `${detail} · Passes again; re-activate it in the CMS`;
    if (!result.ok) failed++;
    await db
      .update(affiliateLinks)
      .set({
        lastHealthCheckAt: now,
        healthDetail: detail,
        finalUrl: result.finalUrl?.slice(0, 2000) ?? null,
        healthFailures: failures,
        ...(pause ? { status: "broken" as const } : {}),
      })
      .where(eq(affiliateLinks.id, link.id));
    if (pause) {
      paused.push(link.id);
      affectedProducts.add(link.productId);
      if (link.status === "active") {
        await notify(db, {
          event: "link.broken",
          title: `Affiliate link paused: ${row.productName} — ${link.label}`,
          body: `${detail}\n\nVisitors now get the next link or the vendor fallback.`,
          href: `/products/${link.productId}`,
          entityType: "affiliate_link",
          entityId: link.id,
          dedupeKey: `link.broken:${link.id}:${day}`,
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(opts.concurrency ?? 4, rows.length) }, async () => {
    while (next < rows.length) await checkOne(rows[next++]!);
  });
  await Promise.all(workers);

  if (affectedProducts.size) {
    const ids = [...affectedProducts];
    const slugs = await db.select({ slug: goSlugs.slug }).from(goSlugs).where(inArray(goSlugs.productId, ids));
    await invalidateGoLinkCache(
      slugs.map((s) => s.slug),
      env,
      fetchImpl,
    );
    // Live reviews may switch CTA targets (direct vs /go), so revalidate their pages.
    const live = await db
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          inArray(articles.productId, ids),
          sql`${articles.publishedVersionId} is not null`,
          ne(articles.status, "archived"),
        ),
      );
    const publishEnv = publishEnvFromProcess(env);
    for (const a of live) {
      await requestRevalidation(publishEnv, { paths: await pathsForArticle(db, a.id) }, fetchImpl);
    }
  }
  return { checked: rows.length, failed, paused, skipped: false };
}
