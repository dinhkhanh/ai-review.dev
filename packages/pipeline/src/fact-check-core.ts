import type { Embedder, Llm } from "@repo/ai";
import { factCheckReportSchema, type CheckedClaim, type ExtractedClaim, type FactCheckReport } from "@repo/content";
import { searchChunks, type ChunkHit } from "@repo/core";
import type { DbOrTx } from "@repo/db";
import { z } from "zod";
import type { RefMap } from "./article-lines";
import { resolvePrompt } from "./prompts";
import { mapLimit } from "./step";

/** What claim verification needs; satisfied by a step context or by the CMS. */
export interface FactCheckDeps {
  db: DbOrTx;
  llm: Llm;
  embedder: Embedder | null;
}

/**
 * The window of `text` (≈ `size` chars) sharing the most terms with `query`, so evidence sent to
 * the fact-checker is focused (and cheap) instead of whole chunks.
 */
export function bestWindow(text: string, query: string, size = 1100): string {
  if (text.length <= size) return text;
  const terms = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9$%.]+/)
      .filter((t) => t.length >= 3),
  );
  const step = Math.floor(size / 4);
  let best = 0;
  let bestScore = -1;
  for (let start = 0; start < text.length; start += step) {
    const words = text
      .slice(start, start + size)
      .toLowerCase()
      .split(/[^a-z0-9$%.]+/);
    const score = words.filter((w) => terms.has(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
    if (start + size >= text.length) break;
  }
  return `${best > 0 ? "…" : ""}${text.slice(best, best + size)}${best + size < text.length ? "…" : ""}`;
}

export const verdictSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["supported", "unsupported", "outdated"]),
      note: z.string(),
      supportingRefs: z.array(z.string()),
    }),
  ),
});

export const fixSchema = z.object({ blocks: z.array(z.object({ id: z.string(), lines: z.array(z.string()) })) });

type Verdict = z.infer<typeof verdictSchema>["results"][number];

/**
 * Evidence per claim: best chunks from the cited sources, or product-wide for uncited claims. With
 * several products (comparisons, lists) every product is searched and the best hits kept.
 */
export async function gatherEvidence(ctx: FactCheckDeps, productIds: string | string[], claims: ExtractedClaim[]) {
  const ids = Array.isArray(productIds) ? productIds : [productIds];
  const vectors = ctx.embedder
    ? await ctx.embedder
        .embed(
          claims.map((c) => c.text),
          { inputType: "query" },
        )
        .catch(() => null)
    : null;
  const evidence = new Map<string, ChunkHit[]>();
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i]!;
    const limit = c.sourceIds.length ? 3 : 2;
    const perProduct = await Promise.all(
      ids.map((productId) =>
        searchChunks(ctx.db, productId, {
          query: c.text,
          embedding: vectors?.[i] ?? null,
          limit,
          ...(c.sourceIds.length ? { sourceIds: c.sourceIds } : {}),
        }),
      ),
    );
    const hits = ids.length === 1 ? perProduct[0]! : perProduct.flat().slice(0, limit * 2);
    evidence.set(c.id, hits);
  }
  return evidence;
}

export async function verifyClaims(
  ctx: FactCheckDeps,
  claims: ExtractedClaim[],
  evidence: Map<string, ChunkHit[]>,
  refs: RefMap,
): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  if (claims.length === 0) return out;
  const prompt = await resolvePrompt(ctx.db, "fact_check");
  // Batches keep each call's evidence focused and the output small; three run at once.
  const batches: ExtractedClaim[][] = [];
  for (let i = 0; i < claims.length; i += 20) batches.push(claims.slice(i, i + 20));
  const results = await mapLimit(batches, 3, async (batch) => {
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "fact_check",
      maxTokens: 16_000,
      schema: verdictSchema,
      prompt: batch
        .map((c) => {
          const ev = evidence.get(c.id) ?? [];
          return [
            `<claim id="${c.id}" ${c.sourceIds.length ? `cites="${c.sourceIds.map(refs.ref).join(",")}"` : `uncited="true"`}>`,
            c.text,
            ...ev.map((h) => `<evidence source="${refs.ref(h.sourceId)}">${bestWindow(h.text, c.text)}</evidence>`),
            ev.length ? "" : "<evidence>none found</evidence>",
            "</claim>",
          ].join("\n");
        })
        .join("\n\n"),
    });
    return res.data.results;
  });
  for (const r of results.flat()) out.set(r.id, r);
  return out;
}

export function buildReport(claims: CheckedClaim[]): FactCheckReport {
  const n = (v: CheckedClaim["verdict"]) => claims.filter((c) => c.verdict === v).length;
  return factCheckReportSchema.parse({
    claims,
    supported: n("supported"),
    unsupported: n("unsupported"),
    outdated: n("outdated"),
    uncited: n("uncited"),
    fixedCount: claims.filter((c) => c.fixed).length,
    checkedAt: new Date().toISOString(),
  });
}

export function toChecked(
  claims: ExtractedClaim[],
  verdicts: Map<string, Verdict>,
  refs: RefMap,
  fixed = new Set<string>(),
) {
  return claims.map((c): CheckedClaim => {
    const v = verdicts.get(c.id);
    const supportIds = (v?.supportingRefs ?? []).map((r) => refs.id(r)).filter((x): x is string => !!x);
    const verdict = !v
      ? c.sourceIds.length
        ? "unsupported"
        : "uncited"
      : v.verdict === "supported"
        ? "supported"
        : v.verdict;
    return {
      id: c.id,
      blockId: c.blockId,
      text: c.text,
      sourceIds: c.sourceIds.length ? c.sourceIds : supportIds,
      verdict: verdict === "supported" && c.sourceIds.length === 0 && supportIds.length === 0 ? "uncited" : verdict,
      note: v?.note ?? (v ? null : "No verdict returned"),
      fixed: fixed.has(c.blockId),
    };
  });
}
