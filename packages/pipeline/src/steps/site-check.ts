import { getProduct, markProductDiscontinued, notify, registrableDomain } from "@repo/core";
import { z } from "zod";
import { defineStep } from "../step";

export type SiteStatus = "ok" | "down" | "moved";

/** HTTP results that mean "the site is gone" rather than "we were blocked". */
const DEAD_STATUSES = new Set([404, 410, 500, 502, 503, 504, 521, 522, 523, 530]);

/**
 * One probe of the homepage. 401/403/429 (bot walls) count as alive: they prove a server answers.
 */
export async function probeSite(
  url: string,
  productDomain: string,
  fetchImpl: typeof fetch,
): Promise<{ status: SiteStatus; detail: string; finalUrl: string | null }> {
  try {
    const res = await fetchImpl(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-review.dev site check)" },
      signal: AbortSignal.timeout(20_000),
    });
    const finalUrl = res.url || url;
    if (DEAD_STATUSES.has(res.status)) return { status: "down", detail: `HTTP ${res.status}`, finalUrl };
    let finalDomain: string | null = null;
    try {
      finalDomain = registrableDomain(finalUrl);
    } catch {
      finalDomain = null;
    }
    if (finalDomain && finalDomain !== productDomain) {
      return { status: "moved", detail: `redirects to ${finalDomain}`, finalUrl };
    }
    return { status: "ok", detail: `HTTP ${res.status}`, finalUrl };
  } catch (error) {
    return { status: "down", detail: `unreachable (${String(error).slice(0, 120)})`, finalUrl: null };
  }
}

/**
 * site_check (FR-MNT-4), refresh jobs only: is the vendor site still there? A site that stays down
 * across retries marks the product discontinued (banner + alternatives on its pages, links paused)
 * and ends the refresh. A redirect to another domain (acquired or rebranded) is reported to the
 * admin but does not change the product, because a rebrand is not a dead product.
 */
export const siteCheckStep = defineStep({
  name: "site_check",
  input: z.object({
    productId: z.uuid(),
    attempts: z.number().int().min(1).max(5).default(3),
    retryDelayMs: z.number().int().min(0).default(5000),
  }),
  output: z.object({
    status: z.enum(["ok", "down", "moved"]),
    detail: z.string(),
    finalUrl: z.string().nullable(),
    discontinued: z.boolean(),
    linksPaused: z.number(),
  }),
  async run(ctx, input) {
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);
    let result = await probeSite(product.websiteUrl, product.domain, ctx.fetch);
    for (let i = 1; i < input.attempts && result.status === "down"; i++) {
      await new Promise((r) => setTimeout(r, input.retryDelayMs));
      result = await probeSite(product.websiteUrl, product.domain, ctx.fetch);
    }
    ctx.log("site check", result);
    let linksPaused = 0;
    if (result.status === "down") {
      const note = `${product.websiteUrl} is no longer reachable (${result.detail}) as of ${new Date().toISOString().slice(0, 10)}.`;
      linksPaused = await markProductDiscontinued(ctx.db, product.id, note);
      await notify(ctx.db, {
        event: "product.discontinued",
        title: `${product.name} looks discontinued`,
        body: `${note} Its pages now show a banner with alternatives and ${linksPaused} affiliate link(s) were paused. If this is wrong, reactivate the product.`,
        href: `/products/${product.id}`,
        entityType: "product",
        entityId: product.id,
        dedupeKey: `product.discontinued:${product.id}`,
      });
    } else if (result.status === "moved") {
      await notify(ctx.db, {
        event: "product.discontinued",
        severity: "info",
        title: `${product.name}'s site now ${result.detail}`,
        body: `The homepage ${product.websiteUrl} ${result.detail} (${result.finalUrl}). It may have been acquired or rebranded; check the product record and its affiliate links. The refresh continues.`,
        href: `/products/${product.id}`,
        entityType: "product",
        entityId: product.id,
        dedupeKey: `product.moved:${product.id}:${result.finalUrl}`,
      });
    }
    return { output: { ...result, discontinued: result.status === "down", linksPaused } };
  },
});
