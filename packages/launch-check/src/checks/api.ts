import { result, type CheckResult, type FetchResult } from "../types.ts";

/** OpenAPI 3.1 document parses and documents the public read surface (FR-API-1). */
export function checkOpenApi(res: FetchResult): CheckResult {
  const ref = "FR-API-1";
  const target = res.url;
  if (res.status !== 200) return result("api.openapi", "fail", `HTTP ${res.status}`, { ref, target });
  let doc: { openapi?: string; paths?: Record<string, unknown>; info?: { version?: string } };
  try {
    doc = JSON.parse(res.body) as typeof doc;
  } catch {
    return result("api.openapi", "fail", "not JSON", { ref, target });
  }
  if (!doc.openapi?.startsWith("3.1"))
    return result("api.openapi", "fail", `openapi ${doc.openapi ?? "missing"}, expected 3.1`, { ref, target });
  const missing = ["/v1/reviews", "/v1/search", "/v1/health"].filter((p) => !doc.paths?.[p]);
  if (missing.length) return result("api.openapi", "fail", `paths missing: ${missing.join(", ")}`, { ref, target });
  return result(
    "api.openapi",
    "pass",
    `OpenAPI ${doc.openapi}, API ${doc.info?.version ?? "?"}, ${Object.keys(doc.paths ?? {}).length} paths`,
    { ref, target },
  );
}

/** A list endpoint returns `{ data: [...] }` (FR-API-2). */
export function checkList(
  id: string,
  res: FetchResult,
  opts: { expectItems: boolean },
): { result: CheckResult; data: unknown[] } {
  const ref = "FR-API-2";
  const target = res.url;
  if (res.status !== 200) return { result: result(id, "fail", `HTTP ${res.status}`, { ref, target }), data: [] };
  let data: unknown;
  try {
    data = (JSON.parse(res.body) as { data?: unknown }).data;
  } catch {
    data = undefined;
  }
  if (!Array.isArray(data))
    return { result: result(id, "fail", "response has no data array", { ref, target }), data: [] };
  if (opts.expectItems && data.length === 0) return { result: result(id, "fail", "empty list", { ref, target }), data };
  return { result: result(id, "pass", `${data.length} item(s)`, { ref, target }), data };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}

/**
 * Search latency (FR-WEB-7, p95 ≤ 300 ms). The budget is server-side, so the network round trip
 * (median of the health baseline) is subtracted before comparing; raw p95 is reported too.
 */
export function checkSearchLatency(
  samples: number[],
  baseline: number[],
  opts: { local: boolean; budgetMs?: number; failures?: number },
): CheckResult {
  const ref = "FR-WEB-7";
  const budget = opts.budgetMs ?? 300;
  if (opts.failures)
    return result(
      "api.search-p95",
      "fail",
      `${opts.failures}/${samples.length + opts.failures} search requests failed`,
      { ref },
    );
  const rtt = percentile(baseline, 50);
  const raw = percentile(samples, 95);
  const adjusted = Math.max(0, raw - (Number.isFinite(rtt) ? rtt : 0));
  const msg = `p95 ${Math.round(adjusted)} ms server-side (raw ${Math.round(raw)} ms, RTT ~${Math.round(rtt)} ms, n=${samples.length})`;
  if (adjusted <= budget) return result("api.search-p95", "pass", msg, { ref });
  return result("api.search-p95", opts.local ? "warn" : "fail", `${msg} > ${budget} ms`, { ref });
}
