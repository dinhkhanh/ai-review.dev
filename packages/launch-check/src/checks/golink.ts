import { result, type CheckResult, type FetchResult } from "../types.ts";

const ref = "FR-AFF-6";

/**
 * Go-link redirect contract: 302 to an absolute off-site URL carrying a SubID
 * (`<article>--<placement>`) or UTM fallback, never cached, never indexed.
 */
export function checkGoRedirect(res: FetchResult, siteOrigin: string, opts: { local: boolean }): CheckResult[] {
  const target = res.url;
  const out: CheckResult[] = [];
  const location = res.headers.get("location");
  if (res.status !== 302)
    return [result("golink.redirect", "fail", `expected 302, got ${res.status}`, { ref, target })];
  let dest: URL | undefined;
  try {
    dest = location && /^https?:\/\//i.test(location) ? new URL(location) : undefined;
  } catch {
    dest = undefined;
  }
  if (!dest)
    return [result("golink.redirect", "fail", `Location is not absolute: ${location ?? "(none)"}`, { ref, target })];
  if (dest.origin === siteOrigin)
    return [
      result(
        "golink.redirect",
        "fail",
        `redirects back to the site (${dest.pathname}): lookup failed or slug unresolved`,
        { ref, target },
      ),
    ];
  if (!opts.local && dest.protocol !== "https:")
    out.push(result("golink.https", "warn", `destination is ${dest.protocol}`, { ref, target }));
  out.push(result("golink.redirect", "pass", `302 → ${dest.host}`, { ref, target }));

  const values = [...dest.searchParams.values()];
  const subId = values.some((v) => /^[a-z0-9-]+--[a-z0-9_-]+/i.test(v));
  const utm = dest.searchParams.has("utm_source");
  out.push(
    subId || utm
      ? result("golink.tracking", "pass", subId ? "SubID present" : "UTM fallback present", {
          ref: "FR-AFF-4/5",
          target,
        })
      : result("golink.tracking", "fail", `no SubID or utm_source on ${dest.host}${dest.pathname}`, {
          ref: "FR-AFF-4/5",
          target,
        }),
  );

  const cache = res.headers.get("cache-control") ?? "";
  out.push(
    /no-store|private/i.test(cache)
      ? result("golink.no-cache", "pass", cache, { ref, target })
      : result("golink.no-cache", "fail", `Cache-Control "${cache}" lets CDNs cache per-visitor redirects`, {
          ref,
          target,
        }),
  );
  const robots = res.headers.get("x-robots-tag") ?? "";
  out.push(
    /noindex/i.test(robots)
      ? result("golink.noindex", "pass", robots, { ref, target })
      : result("golink.noindex", "fail", "X-Robots-Tag noindex missing", { ref, target }),
  );
  return out;
}

export function checkGoUnknown(res: FetchResult): CheckResult {
  return res.status === 404
    ? result("golink.unknown", "pass", "unknown slug → 404", { ref, target: res.url })
    : result("golink.unknown", "fail", `unknown slug returned ${res.status}`, { ref, target: res.url });
}
