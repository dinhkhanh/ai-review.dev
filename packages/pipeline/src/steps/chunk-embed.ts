import { countChunks, listChunksMissingEmbeddings, listSources, replaceChunks, setChunkEmbedding } from "@repo/core";
import { z } from "zod";
import { chunkMarkdown, estimateTokens } from "../research/chunk";
import { defineStep } from "../step";

/** chunk_embed (FR-RES-3): ~800-token chunks per source, embedded when a provider is configured. */
export const chunkEmbedStep = defineStep({
  name: "chunk_embed",
  input: z.object({ productId: z.uuid() }),
  output: z.object({
    sources: z.number(),
    chunks: z.number(),
    embedded: z.number(),
    embeddingModel: z.string().nullable(),
  }),
  async run(ctx, input) {
    const sources = await listSources(ctx.db, input.productId, { withContent: true });
    for (const source of sources) {
      const pieces = chunkMarkdown(source.contentMd ?? "");
      await replaceChunks(
        ctx.db,
        source,
        pieces.map((text) => ({ text, tokenCount: estimateTokens(text) })),
      );
    }
    if (ctx.embedder) {
      // Embeddings improve retrieval but are optional: on provider errors (e.g. rate limits) the
      // remaining chunks stay unembedded and retrieval falls back to full-text search.
      try {
        for (;;) {
          const batch = await listChunksMissingEmbeddings(ctx.db, input.productId, 128);
          if (batch.length === 0) break;
          const vectors = await ctx.embedder.embed(
            batch.map((c) => c.text),
            { inputType: "document" },
          );
          for (let i = 0; i < batch.length; i++) await setChunkEmbedding(ctx.db, batch[i]!.id, vectors[i]!);
        }
      } catch (error) {
        ctx.log("embedding failed; retrieval will use full-text search", { error: String(error).slice(0, 300) });
      }
    } else {
      ctx.log("no embedding provider configured; retrieval uses full-text search");
    }
    const counts = await countChunks(ctx.db, input.productId);
    return {
      output: {
        sources: sources.length,
        chunks: counts.total,
        embedded: counts.embedded,
        embeddingModel: ctx.embedder?.model ?? null,
      },
    };
  },
});
