import { getProduct, updateProduct, upsertSource, setSourceScreenshot } from "@repo/core";
import { downloadImage, saveImageAsset } from "@repo/media";
import { z } from "zod";
import { createRobotsChecker } from "../research/robots";
import { selectOfficialUrls } from "../research/urls";
import { defineStep, mapLimit, type StepContext } from "../step";

/** Pages that get desktop + mobile screenshots as original evidence (FR-RES-6). */
const SCREENSHOT_KEYS = new Set(["home", "pricing"]);

async function storeScreenshot(ctx: StepContext, productId: string, url: string, role: string): Promise<string | null> {
  if (!ctx.storage) return null;
  try {
    const bytes = await downloadImage(url, 15 * 1024 * 1024, ctx.fetch);
    const asset = await saveImageAsset(ctx.db, ctx.storage, {
      bytes,
      kind: "screenshot",
      origin: "captured",
      prefix: `products/${productId}/screenshots`,
      role,
      productId,
      capturedAt: new Date(),
      licenseNote: "Screenshot of a public page captured by ai-review.dev for review purposes.",
    });
    return asset.id;
  } catch (error) {
    ctx.log("screenshot store failed", { role, error: String(error) });
    return null;
  }
}

/** crawl_official (FR-RES-1, FR-RES-6): map the site, scrape ≤ 15 key pages, capture screenshots. */
export const crawlOfficialStep = defineStep({
  name: "crawl_official",
  input: z.object({ productId: z.uuid(), maxPages: z.number().int().min(1).max(30).default(15) }),
  output: z.object({
    sourceIds: z.array(z.string()),
    screenshots: z.array(z.object({ role: z.string(), assetId: z.string() })),
    skipped: z.array(z.object({ url: z.string(), reason: z.string() })),
  }),
  async run(ctx, input) {
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);
    const robots = createRobotsChecker(ctx.fetch);

    let links: string[] = [];
    try {
      links = await ctx.firecrawl.map(product.websiteUrl, { limit: 400 });
    } catch (error) {
      ctx.log("site map failed; using homepage links only", { error: String(error) });
    }
    const targets = selectOfficialUrls(links, {
      websiteUrl: product.websiteUrl,
      pricingUrl: product.profile?.pricingUrl,
      limit: input.maxPages,
    });
    ctx.log("selected official pages", { count: targets.length, pages: targets.map((t) => `${t.key}: ${t.url}`) });

    const skipped: Array<{ url: string; reason: string }> = [];
    const screenshots: Array<{ role: string; assetId: string }> = [];
    const sourceIds: string[] = [];

    await mapLimit(targets, 4, async (target) => {
      if (!(await robots.isAllowed(target.url))) {
        skipped.push({ url: target.url, reason: "robots.txt disallows" });
        return;
      }
      const wantShot = SCREENSHOT_KEYS.has(target.key);
      try {
        const page = await ctx.firecrawl.scrape(target.url, { screenshot: wantShot, maxAgeMs: 0 });
        if ((page.statusCode ?? 200) >= 400 || page.markdown.trim().length < 200) {
          skipped.push({ url: target.url, reason: `thin or error page (HTTP ${page.statusCode ?? "?"})` });
          return;
        }
        const source = await upsertSource(ctx.db, {
          productId: product.id,
          url: page.url || target.url,
          kind: "official",
          title: page.title,
          httpStatus: page.statusCode,
          robotsAllowed: true,
          contentMd: page.markdown.slice(0, 120_000),
          jobId: ctx.jobId,
        });
        sourceIds.push(source.id);
        if (wantShot && page.screenshotUrl) {
          const assetId = await storeScreenshot(
            ctx,
            product.id,
            page.screenshotUrl,
            `screenshot:${target.key}:desktop`,
          );
          if (assetId) {
            screenshots.push({ role: `screenshot:${target.key}:desktop`, assetId });
            await setSourceScreenshot(ctx.db, source.id, assetId);
          }
        }
        if (wantShot) {
          const mobile = await ctx.firecrawl.scrape(target.url, { screenshot: true, mobile: true, maxAgeMs: 0 });
          if (mobile.screenshotUrl) {
            const assetId = await storeScreenshot(
              ctx,
              product.id,
              mobile.screenshotUrl,
              `screenshot:${target.key}:mobile`,
            );
            if (assetId) screenshots.push({ role: `screenshot:${target.key}:mobile`, assetId });
          }
        }
      } catch (error) {
        skipped.push({ url: target.url, reason: String(error).slice(0, 200) });
      }
    });

    if (sourceIds.length === 0) throw new Error("No official pages could be read; check the URL or robots.txt");
    await updateProduct(ctx.db, product.id, { lastResearchedAt: new Date() });
    ctx.log("crawl complete", { sources: sourceIds.length, screenshots: screenshots.length, skipped: skipped.length });
    return { output: { sourceIds, screenshots, skipped } };
  },
});
