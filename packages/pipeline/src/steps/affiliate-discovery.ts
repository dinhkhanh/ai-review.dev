import { KNOWN_NETWORKS } from "@repo/affiliate";
import { getProduct, upsertDiscoveredProgram } from "@repo/core";
import { z } from "zod";
import { clip } from "../research/chunk";
import { sameSite } from "../research/urls";
import { defineStep, mapLimit } from "../step";

const NETWORK_DOMAINS =
  /partnerstack\.com|impact\.com|awin\.com|shareasale\.com|cj\.com|getrewardful\.com|rewardful\.com|firstpromoter\.com|tolt\.(io|com)|lemonsqueezy\.com|appsumo\.com|paddle\.com|gumroad\.com/i;

export const programDraftSchema = z.object({
  programs: z.array(
    z.object({
      name: z.string(),
      network: z.enum(KNOWN_NETWORKS),
      commissionModel: z.enum([
        "recurring_percent",
        "one_time_percent",
        "flat_per_sale",
        "flat_per_lead",
        "hybrid",
        "unknown",
      ]),
      commissionValue: z.number().nullable(),
      recurringMonths: z.number().nullable(),
      cookieDays: z.number().nullable(),
      signupUrl: z.string().nullable(),
      termsUrl: z.string().nullable(),
      linkFormat: z.enum(["query_param", "network_link", "static_url", "unknown"]),
      linkParam: z.string().nullable(),
      redirectPolicy: z.enum(["allowed", "forbidden", "unknown"]),
      evidence: z.array(z.object({ url: z.string(), note: z.string() })),
      draftApplication: z.string(),
    }),
  ),
});

function httpUrl(u: string | null): string | null {
  try {
    return u && /^https?:/.test(new URL(u).protocol) ? new URL(u).toString() : null;
  } catch {
    return null;
  }
}

/**
 * affiliate_discovery (FR-AFF-1): vendor partner pages + network directories + web search.
 * Non-critical: the orchestrator never lets a failure here block the article (SRS §7).
 */
export const affiliateDiscoveryStep = defineStep({
  name: "affiliate_discovery",
  input: z.object({ productId: z.uuid() }),
  output: z.object({
    programs: z.array(z.object({ id: z.string(), network: z.string(), name: z.string() })),
    pagesRead: z.number(),
  }),
  async run(ctx, input) {
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);

    const candidates = new Set<string>();
    try {
      const onSite = await ctx.firecrawl.map(product.websiteUrl, { search: "affiliate partner referral", limit: 30 });
      onSite
        .filter((u) => /affiliat|partner|referr|ambassador|creator/i.test(u))
        .slice(0, 3)
        .forEach((u) => candidates.add(u));
    } catch (error) {
      ctx.log("partner page map failed", { error: String(error) });
    }
    const hits = await ctx.firecrawl
      .search(`"${product.name}" affiliate program commission`, { limit: 8 })
      .catch(() => []);
    hits
      .filter((h) => sameSite(h.url, product.websiteUrl) || NETWORK_DOMAINS.test(h.url))
      .slice(0, 3)
      .forEach((h) => candidates.add(h.url));

    const pages = (
      await mapLimit([...candidates].slice(0, 5), 3, async (url) => {
        try {
          const page = await ctx.firecrawl.scrape(url, { maxAgeMs: 7 * 24 * 3600 * 1000 });
          return { url: page.url || url, markdown: page.markdown };
        } catch {
          return null;
        }
      })
    ).filter((p): p is { url: string; markdown: string } => !!p && p.markdown.length > 100);
    ctx.log("affiliate evidence", { pages: pages.map((p) => p.url), searchHits: hits.length });
    if (pages.length === 0 && hits.length === 0) return { output: { programs: [], pagesRead: 0 } };

    const prompt = await ctx.prompt("affiliate_discovery");
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "affiliate_discovery",
      maxTokens: 8000,
      schema: programDraftSchema,
      prompt: [
        `Product: ${product.name} (${product.websiteUrl})`,
        `Search results:\n${hits.map((h) => `- ${h.title ?? ""} — ${h.url}\n  ${h.description ?? ""}`).join("\n")}`,
        ...pages.map((p) => `<page url="${p.url}">\n${clip(p.markdown, 10_000)}\n</page>`),
      ].join("\n\n"),
    });

    const programs = [];
    for (const p of res.data.programs) {
      const linkFormat =
        p.linkFormat === "query_param" && p.linkParam
          ? null // The referral value is account-specific; the admin completes it after approval.
          : p.linkFormat === "network_link" && p.network !== "direct" && p.network !== "other"
            ? { kind: "network_link" as const, network: p.network }
            : null;
      const row = await upsertDiscoveredProgram(ctx.db, {
        productId: product.id,
        network: p.network,
        name: p.name,
        status: "found",
        commissionModel: p.commissionModel,
        commissionValue: p.commissionValue,
        recurringMonths: p.recurringMonths === null ? null : Math.round(p.recurringMonths),
        cookieDays: p.cookieDays === null ? null : Math.round(p.cookieDays),
        signupUrl: httpUrl(p.signupUrl),
        termsUrl: httpUrl(p.termsUrl),
        linkFormat,
        redirectPolicy: p.redirectPolicy,
        evidence: p.evidence.filter((e) => httpUrl(e.url)),
        draftApplication: p.draftApplication,
        notes: p.linkFormat === "query_param" && p.linkParam ? `Referral links use ?${p.linkParam}=<your id>` : null,
      });
      programs.push({ id: row.id, network: row.network, name: row.name });
    }
    return {
      output: { programs, pagesRead: pages.length },
      model: res.model,
      effort: prompt.effort,
      promptVersion: prompt.version,
    };
  },
});
