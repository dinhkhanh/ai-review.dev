import type { SearchHit } from "@repo/ai";
import { getProduct, upsertSource } from "@repo/core";
import { z } from "zod";
import { createRobotsChecker } from "../research/robots";
import { AGGREGATOR_DOMAINS, classifyThirdParty, sameSite, type ThirdPartyKind } from "../research/urls";
import { defineStep, mapLimit } from "../step";

const QUOTA: Record<ThirdPartyKind, number> = { aggregator: 3, community: 3, news: 3, video: 1 };

function mentions(hit: SearchHit, name: string): boolean {
  const needle = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const hay = `${hit.title ?? ""} ${hit.url} ${hit.description ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return needle.length > 0 && hay.includes(needle);
}

/** collect_third_party (FR-RES-2): review aggregators, community threads, news/blog reviews, video. */
export const collectThirdPartyStep = defineStep({
  name: "collect_third_party",
  input: z.object({ productId: z.uuid() }),
  output: z.object({
    sourceIds: z.array(z.string()),
    byKind: z.record(z.string(), z.number()),
    skipped: z.array(z.object({ url: z.string(), reason: z.string() })),
  }),
  async run(ctx, input) {
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);
    const name = product.name;
    const queries: Array<{ q: string; includeDomains?: string[] }> = [
      { q: `${name} reviews`, includeDomains: AGGREGATOR_DOMAINS },
      { q: `${name} review reddit`, includeDomains: ["reddit.com"] },
      { q: `${name}`, includeDomains: ["news.ycombinator.com"] },
      { q: `${name} review ${new Date().getUTCFullYear()}` },
      { q: `${name} review`, includeDomains: ["youtube.com"] },
    ];
    const results = await mapLimit(queries, 3, async ({ q, includeDomains }) => {
      try {
        return await ctx.firecrawl.search(q, { limit: 6, includeDomains });
      } catch (error) {
        ctx.log("search failed", { q, error: String(error) });
        return [];
      }
    });

    const seen = new Set<string>();
    const picked: Array<{ hit: SearchHit; kind: ThirdPartyKind }> = [];
    const counts: Record<ThirdPartyKind, number> = { aggregator: 0, community: 0, news: 0, video: 0 };
    for (const hit of results.flat()) {
      const key = hit.url.replace(/[?#].*$/, "").replace(/\/+$/, "");
      if (seen.has(key) || sameSite(hit.url, product.websiteUrl) || !mentions(hit, name)) continue;
      seen.add(key);
      const kind = classifyThirdParty(hit.url);
      if (counts[kind] >= QUOTA[kind]) continue;
      counts[kind]++;
      picked.push({ hit, kind });
    }
    ctx.log("third-party candidates", { picked: picked.map((p) => `${p.kind}: ${p.hit.url}`) });

    const robots = createRobotsChecker(ctx.fetch);
    const skipped: Array<{ url: string; reason: string }> = [];
    const stored = await mapLimit(picked, 4, async ({ hit, kind }) => {
      if (!(await robots.isAllowed(hit.url))) {
        skipped.push({ url: hit.url, reason: "robots.txt disallows" });
        return null;
      }
      try {
        // Video pages rarely expose transcripts to scrapers; keep the description as evidence.
        const page = kind === "video" ? null : await ctx.firecrawl.scrape(hit.url, { maxAgeMs: 7 * 24 * 3600 * 1000 });
        const content =
          page && page.markdown.trim().length >= 300
            ? page.markdown.slice(0, 80_000)
            : `${hit.title ?? ""}\n\n${hit.description ?? ""}`.trim();
        if (content.length < 80) {
          skipped.push({ url: hit.url, reason: "no usable content" });
          return null;
        }
        const source = await upsertSource(ctx.db, {
          productId: product.id,
          url: page?.url || hit.url,
          kind,
          title: page?.title ?? hit.title,
          httpStatus: page?.statusCode ?? null,
          robotsAllowed: true,
          contentMd: content,
          jobId: ctx.jobId,
        });
        return { id: source.id, kind };
      } catch (error) {
        skipped.push({ url: hit.url, reason: String(error).slice(0, 200) });
        return null;
      }
    });
    const ok = stored.filter((s): s is { id: string; kind: ThirdPartyKind } => !!s);
    const byKind: Record<string, number> = {};
    for (const s of ok) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
    ctx.log("third-party sources stored", { byKind, skipped: skipped.length });
    return { output: { sourceIds: ok.map((s) => s.id), byKind, skipped } };
  },
});
