import Firecrawl, { type Document, type MapData, type SearchData } from "@mendable/firecrawl-js";
import type { CostHandler } from "../cost-event";

/** Subset of the Firecrawl client this adapter uses; tests pass a fake. */
export interface FirecrawlLike {
  scrape(
    url: string,
    options: {
      formats: Array<"markdown" | "links" | "screenshot">;
      onlyMainContent?: boolean;
      maxAge?: number;
      mobile?: boolean;
      timeout?: number;
    },
  ): Promise<Document>;
  search(query: string, req?: { limit?: number; includeDomains?: string[]; tbs?: string }): Promise<SearchData>;
  map(url: string, options?: { search?: string; limit?: number }): Promise<MapData>;
}

export interface FirecrawlAdapterOptions {
  client?: FirecrawlLike;
  apiKey?: string;
  onCost?: CostHandler;
  /** USD per Firecrawl credit for the current plan; used for the ledger. */
  creditPriceUsd?: number;
  pacing?: Partial<FirecrawlPacing>;
}

export interface ScrapedPage {
  url: string;
  title: string | null;
  markdown: string;
  links: string[];
  /** Hosted screenshot URL returned by Firecrawl (expires; copy to R2 before storing). */
  screenshotUrl: string | null;
  statusCode: number | null;
  description: string | null;
  /** og:image and favicon from page metadata, used for logo resolution (FR-MED-5). */
  ogImage: string | null;
  favicon: string | null;
}

export interface SearchHit {
  url: string;
  title: string | null;
  description: string | null;
}

/**
 * Process-wide pacing for Firecrawl: plans cap requests per minute (≈10 on the entry plan), and
 * several pipeline steps scrape in parallel. Calls are spaced to stay under FIRECRAWL_RPM.
 */
let nextSlot = 0;
async function pace(rpm: number) {
  const gap = Math.ceil(60_000 / Math.max(1, rpm));
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gap;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** Seconds to wait from a Firecrawl rate-limit error ("retry after 46s"), or null if not one. */
export function rateLimitDelay(error: unknown): number | null {
  const text = String((error as { message?: string })?.message ?? error);
  if (!/rate limit|429|too many requests/i.test(text)) return null;
  const m = /retry after (\d+)\s*s/i.exec(text);
  return m ? Number(m[1]) + 1 : 30;
}

export interface FirecrawlPacing {
  rpm: number;
  /** Retries after a rate-limit error before giving up. */
  maxRetries: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Research adapter over Firecrawl (docs/plan.md §3). Every call reports credits to the ledger. */
export function createFirecrawl(options: FirecrawlAdapterOptions = {}) {
  const client: FirecrawlLike =
    options.client ??
    (new Firecrawl({ apiKey: options.apiKey ?? process.env.FIRECRAWL_API_KEY }) as unknown as FirecrawlLike);
  const creditPrice = options.creditPriceUsd ?? 0.001;
  const pacing: FirecrawlPacing = {
    rpm: Number(process.env.FIRECRAWL_RPM) || 10,
    maxRetries: 4,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    ...options.pacing,
  };
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      await pace(pacing.rpm);
      try {
        return await fn();
      } catch (error) {
        const wait = rateLimitDelay(error);
        if (wait === null || attempt >= pacing.maxRetries) throw error;
        await pacing.sleep!(wait * 1000);
      }
    }
  };

  const report = async (operation: string, credits: number, meta: Record<string, unknown>) => {
    if (!options.onCost) return;
    await options.onCost({
      provider: "firecrawl",
      operation,
      units: credits,
      unitType: "credits",
      costUsd: credits * creditPrice,
      meta,
    });
  };

  return {
    async scrape(
      url: string,
      opts: {
        screenshot?: boolean;
        mobile?: boolean;
        maxAgeMs?: number;
        fullContent?: boolean;
        timeoutMs?: number;
      } = {},
    ): Promise<ScrapedPage> {
      const doc = await call(() =>
        client.scrape(url, {
          formats: opts.screenshot ? ["markdown", "links", "screenshot"] : ["markdown", "links"],
          onlyMainContent: !opts.fullContent,
          ...(opts.mobile ? { mobile: true } : {}),
          ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
          ...(opts.maxAgeMs !== undefined ? { maxAge: opts.maxAgeMs } : {}),
        }),
      );
      const meta = (doc.metadata ?? {}) as Record<string, unknown>;
      const str = (v: unknown) =>
        typeof v === "string" && v ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
      await report("scrape", typeof meta.creditsUsed === "number" ? meta.creditsUsed : 1, {
        url,
        mobile: !!opts.mobile,
      });
      return {
        url: str(meta.sourceURL) ?? url,
        title: str(meta.title) ?? str(meta.ogTitle),
        markdown: doc.markdown ?? "",
        links: doc.links ?? [],
        screenshotUrl: doc.screenshot ?? null,
        statusCode: typeof meta.statusCode === "number" ? meta.statusCode : null,
        description: str(meta.description) ?? str(meta.ogDescription),
        ogImage: str(meta.ogImage) ?? str(meta["og:image"]),
        favicon: str(meta.favicon),
      };
    },

    async search(
      query: string,
      opts: { limit?: number; includeDomains?: string[]; tbs?: string } = {},
    ): Promise<SearchHit[]> {
      const limit = opts.limit ?? 10;
      const data = await call(() =>
        client.search(query, {
          limit,
          ...(opts.includeDomains?.length ? { includeDomains: opts.includeDomains } : {}),
          ...(opts.tbs ? { tbs: opts.tbs } : {}),
        }),
      );
      // Firecrawl bills search per 10 results returned (rounded up).
      const hits = (data.web ?? [])
        .map((r) => {
          const rec = r as unknown as Record<string, unknown>;
          const metadata = (rec.metadata ?? {}) as Record<string, unknown>;
          return {
            url: String(rec.url ?? metadata.sourceURL ?? ""),
            title: (rec.title ?? metadata.title ?? null) as string | null,
            description: (rec.description ?? metadata.description ?? null) as string | null,
          };
        })
        .filter((h) => h.url);
      await report("search", Math.max(1, Math.ceil(hits.length / 10)) * 2, { query, results: hits.length });
      return hits;
    },

    async map(url: string, opts: { search?: string; limit?: number } = {}): Promise<string[]> {
      const data = await call(() => client.map(url, { ...opts }));
      await report("map", 1, { url, links: data.links.length });
      return data.links.map((l) => l.url);
    },
  };
}

export type FirecrawlAdapter = ReturnType<typeof createFirecrawl>;
