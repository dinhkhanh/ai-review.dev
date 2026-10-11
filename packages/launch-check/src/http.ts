import type { FetchResult } from "./types.ts";

/** Contains "bot" and "monitor" so the go-link click logger flags our requests (isBotUserAgent). */
export const USER_AGENT = "ai-review-launch-check/1.0 (+bot; monitor)";

export type Fetcher = (
  url: string,
  init?: { redirect?: "follow" | "manual"; timeoutMs?: number },
) => Promise<FetchResult>;

/** Limits how many requests run at once (be polite to production). */
export function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

/** GET-only fetcher with a timeout, one retry on network errors and at most `concurrency` in flight. */
export function createFetcher(concurrency = 4): Fetcher {
  const run = limiter(concurrency);
  return (url, init = {}) =>
    run(async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        const started = performance.now();
        try {
          const res = await fetch(url, {
            method: "GET",
            redirect: init.redirect ?? "follow",
            headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
            signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
          });
          const body = await res.text();
          return {
            url: res.url || url,
            status: res.status,
            headers: res.headers,
            body,
            ms: performance.now() - started,
          };
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(`GET ${url} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    });
}
