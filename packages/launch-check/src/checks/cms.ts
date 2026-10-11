import { metaContent } from "../html.ts";
import { result, type CheckResult, type FetchResult } from "../types.ts";

/** CMS login is reachable and kept out of search; unauthenticated root redirects to login (FR-CMS-1). */
export function checkCmsLogin(res: FetchResult): CheckResult[] {
  const target = res.url;
  const ref = "FR-CMS-1";
  if (res.status !== 200) return [result("cms.login", "fail", `HTTP ${res.status}`, { ref, target })];
  const robots = `${metaContent(res.body, "robots") ?? ""} ${res.headers.get("x-robots-tag") ?? ""}`;
  return [
    result("cms.login", "pass", "login page reachable", { ref, target }),
    /noindex/i.test(robots)
      ? result("cms.noindex", "pass", robots.trim(), { ref, target })
      : result("cms.noindex", "fail", "login page is indexable (no noindex meta or X-Robots-Tag)", { ref, target }),
  ];
}

export function checkCmsGate(res: FetchResult): CheckResult {
  const target = res.url;
  const location = res.headers.get("location") ?? "";
  if ((res.status >= 300 && res.status < 400 && /\/login\b/.test(location)) || res.status === 401 || res.status === 403)
    return result("cms.auth-gate", "pass", `unauthenticated / → ${res.status}${location ? ` ${location}` : ""}`, {
      ref: "FR-CMS-1",
      target,
    });
  return result("cms.auth-gate", "fail", `unauthenticated / returned ${res.status}`, { ref: "FR-CMS-1", target });
}
