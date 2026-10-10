import Firecrawl, { type Document, type MapData, type SearchData } from "@mendable/firecrawl-js";
import type { CostHandler } from "../cost-event";

/** Subset of the Firecrawl client this adapter uses; tests pass a fake. */
export interface FirecrawlLike {
  scrape(
    url: string,
    options: { formats: Array<"markdown" | "links" | "screenshot">; onlyMainContent?: boolean; maxAge?: number },
  ): Promise<Document>;
  search(query: string, req?: { limit?: number }): Promise<SearchData>;
  map(url: string, options?: { search?: string; limit?: number }): Promise<MapData>;
}

export interface FirecrawlAdapterOptions {
  client?: FirecrawlLike;
  apiKey?: string;
  onCost?: CostHandler;
  /** USD per Firecrawl credit for the current plan; used for the ledger. */
  creditPriceUsd?: number;
}

export interface ScrapedPage {
  url: string;
  title: string | null;
  markdown: string;
  links: string[];
  /** Hosted screenshot URL returned by Firecrawl (expires; copy to R2 before storing). */
  screenshotUrl: string | null;
  statusCode: number | null;
}

export interface SearchHit {
  url: string;
  title: string | null;
  description: string | null;
}

/** Research adapter over Firecrawl (docs/plan.md §3). Every call reports credits to the ledger. */
export function createFirecrawl(options: FirecrawlAdapterOptions = {}) {
  const client: FirecrawlLike =
    options.client ??
    (new Firecrawl({ apiKey: options.apiKey ?? process.env.FIRECRAWL_API_KEY }) as unknown as FirecrawlLike);
  const creditPrice = options.creditPriceUsd ?? 0.001;

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
    async scrape(url: string, opts: { screenshot?: boolean; maxAgeMs?: number } = {}): Promise<ScrapedPage> {
      const doc = await client.scrape(url, {
        formats: opts.screenshot ? ["markdown", "links", "screenshot"] : ["markdown", "links"],
        onlyMainContent: true,
        ...(opts.maxAgeMs !== undefined ? { maxAge: opts.maxAgeMs } : {}),
      });
      const meta = (doc.metadata ?? {}) as Record<string, unknown>;
      await report("scrape", typeof meta.creditsUsed === "number" ? meta.creditsUsed : 1, { url });
      return {
        url: typeof meta.sourceURL === "string" ? meta.sourceURL : url,
        title: typeof meta.title === "string" ? meta.title : null,
        markdown: doc.markdown ?? "",
        links: doc.links ?? [],
        screenshotUrl: doc.screenshot ?? null,
        statusCode: typeof meta.statusCode === "number" ? meta.statusCode : null,
      };
    },

    async search(query: string, opts: { limit?: number } = {}): Promise<SearchHit[]> {
      const limit = opts.limit ?? 10;
      const data = await client.search(query, { limit });
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
      const data = await client.map(url, { ...opts });
      await report("map", 1, { url, links: data.links.length });
      return data.links.map((l) => l.url);
    },
  };
}

export type FirecrawlAdapter = ReturnType<typeof createFirecrawl>;
