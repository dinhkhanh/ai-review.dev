import robotsParser from "robots-parser";

export const BOT_USER_AGENT = "Mozilla/5.0 (compatible; AIReviewBot/1.0; +https://ai-review.dev/editorial-policy)";
const BOT_TOKEN = "AIReviewBot";

/**
 * robots.txt gate (constraint C-7). One fetch per origin per run; an unreachable robots.txt
 * means "allowed", as crawlers conventionally treat it.
 */
export function createRobotsChecker(fetchImpl: typeof fetch = fetch) {
  const cache = new Map<string, Promise<ReturnType<typeof robotsParser> | null>>();
  const load = (origin: string) => {
    let entry = cache.get(origin);
    if (!entry) {
      entry = (async () => {
        try {
          const res = await fetchImpl(`${origin}/robots.txt`, {
            headers: { "User-Agent": BOT_USER_AGENT },
            signal: AbortSignal.timeout(8_000),
            redirect: "follow",
          });
          if (!res.ok) return null;
          return robotsParser(`${origin}/robots.txt`, (await res.text()).slice(0, 500_000));
        } catch {
          return null;
        }
      })();
      cache.set(origin, entry);
    }
    return entry;
  };
  return {
    async isAllowed(url: string): Promise<boolean> {
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        return false;
      }
      const robots = await load(origin);
      if (!robots) return true;
      return robots.isAllowed(url, BOT_TOKEN) !== false;
    },
  };
}
