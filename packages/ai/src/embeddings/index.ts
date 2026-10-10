import type { CostHandler } from "../cost-event";

/**
 * Embeddings adapter (SRS §4.2, FR-RES-3). Voyage AI by default; returns null from the factory
 * when no key is configured so research falls back to keyword retrieval.
 */
export interface Embedder {
  model: string;
  dimensions: number;
  embed(texts: string[], opts?: { inputType?: "document" | "query" }): Promise<number[][]>;
}

export interface VoyageOptions {
  apiKey?: string;
  /** voyage-3.5 outputs 1024 dimensions, matching `research_chunks.embedding`. */
  model?: string;
  onCost?: CostHandler;
  fetchImpl?: typeof fetch;
  batchSize?: number;
}

/** USD per million tokens (list prices, 2026-10). */
export const VOYAGE_PRICING: Record<string, number> = {
  "voyage-3.5": 0.06,
  "voyage-3.5-lite": 0.02,
  "voyage-3-large": 0.18,
};

export function createVoyageEmbedder(options: VoyageOptions = {}): Embedder | null {
  const apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) return null;
  const model = options.model ?? "voyage-3.5";
  const fetchImpl = options.fetchImpl ?? fetch;
  const batchSize = options.batchSize ?? 64;

  return {
    model,
    dimensions: 1024,
    async embed(texts, opts = {}) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const res = await fetchImpl("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            input: batch,
            model,
            input_type: opts.inputType ?? "document",
            output_dimension: 1024,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok)
          throw new Error(`Voyage embeddings failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
        const body = (await res.json()) as {
          data: Array<{ embedding: number[]; index: number }>;
          usage?: { total_tokens?: number };
        };
        const sorted = [...body.data].sort((a, b) => a.index - b.index);
        out.push(...sorted.map((d) => d.embedding));
        const tokens = body.usage?.total_tokens ?? 0;
        if (options.onCost) {
          await options.onCost({
            provider: "voyage",
            model,
            operation: "embed",
            units: tokens,
            unitType: "tokens",
            costUsd: (tokens * (VOYAGE_PRICING[model] ?? 0.06)) / 1_000_000,
            meta: { inputs: batch.length, inputType: opts.inputType ?? "document" },
          });
        }
      }
      return out;
    },
  };
}
