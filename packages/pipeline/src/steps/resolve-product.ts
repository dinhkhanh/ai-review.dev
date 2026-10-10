import { LAUNCH_CATEGORIES, productProfileSchema } from "@repo/content";
import {
  assertPublicHttpUrl,
  ensureGoSlug,
  findOrCreateProduct,
  getProduct,
  normalizeWebsiteUrl,
  setJobLinks,
  updateProduct,
} from "@repo/core";
import { categories, eq } from "@repo/db";
import { saveImageAsset } from "@repo/media";
import { z } from "zod";
import { defineStep, type StepContext } from "../step";

const categorySlugs = LAUNCH_CATEGORIES.map((c) => c.slug) as [string, ...string[]];

export const resolvedSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  categorySlug: z.enum(categorySlugs),
  pricingUrl: z.string().nullable(),
  docsUrl: z.string().nullable(),
  changelogUrl: z.string().nullable(),
  socials: z.array(z.object({ network: z.string(), url: z.string() })),
  appStores: z.array(z.string()),
});

const SOCIAL_HOSTS =
  /(?:^|\.)(x\.com|twitter\.com|linkedin\.com|youtube\.com|github\.com|facebook\.com|instagram\.com|discord\.gg|discord\.com|tiktok\.com|threads\.net)$/i;
const STORE_HOSTS =
  /(apps\.apple\.com|play\.google\.com|chromewebstore\.google\.com|chrome\.google\.com|apps\.microsoft\.com)/i;

function validUrl(value: string | null | undefined, allowed: (u: URL) => boolean): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    u.hash = "";
    return (u.protocol === "https:" || u.protocol === "http:") && allowed(u) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Tries apple-touch-icon, then the page favicon, as the product logo (FR-MED-5). */
async function captureLogo(ctx: StepContext, product: { id: string; websiteUrl: string }, favicon: string | null) {
  if (!ctx.storage) return null;
  const candidates = [`${product.websiteUrl}/apple-touch-icon.png`, favicon].filter((u): u is string => !!u);
  for (const url of candidates) {
    try {
      const res = await ctx.fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/image\/(png|jpe?g|webp|gif|svg)/.test(type)) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 200 || bytes.length > 2_000_000) continue;
      const asset = await saveImageAsset(ctx.db, ctx.storage, {
        bytes,
        kind: "logo",
        origin: "vendor",
        prefix: `products/${product.id}/logo`,
        role: "logo",
        productId: product.id,
        lossless: true,
        licenseNote: "Vendor logo, used for identification only (nominative use).",
      });
      return asset.id;
    } catch (error) {
      ctx.log("logo candidate failed", { url, error: String(error) });
    }
  }
  return null;
}

/**
 * resolve_product (FR-INT-3/4): canonical identity from the homepage, dedup by domain, go-slug,
 * logo. A refresh job passes `productId` and only re-reads the homepage.
 */
export const resolveProductStep = defineStep({
  name: "resolve_product",
  input: z.object({
    url: z.string().nullable().default(null),
    name: z.string().nullable().default(null),
    categorySlug: z.string().nullable().default(null),
    productId: z.uuid().nullable().default(null),
  }),
  output: z.object({
    productId: z.uuid(),
    slug: z.string(),
    name: z.string(),
    websiteUrl: z.string(),
    created: z.boolean(),
    goSlug: z.string(),
    logoAssetId: z.string().nullable(),
  }),
  async run(ctx, input) {
    const existing = input.productId ? await getProduct(ctx.db, input.productId) : null;
    if (input.productId && !existing) throw new Error(`Product ${input.productId} not found`);
    const rawUrl = existing?.websiteUrl ?? input.url;
    if (!rawUrl) throw new Error("resolve_product needs a URL (the intake form resolves names to URLs)");
    const websiteUrl = normalizeWebsiteUrl(rawUrl);
    assertPublicHttpUrl(websiteUrl);

    const page = await ctx.firecrawl.scrape(websiteUrl, { fullContent: true, maxAgeMs: 0 });
    const prompt = await ctx.prompt("resolve_product");
    const links = page.links
      .filter((l) => /^https?:\/\//.test(l))
      .filter((l, i, all) => all.indexOf(l) === i)
      .slice(0, 250);
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "resolve_product",
      maxTokens: 4000,
      schema: resolvedSchema,
      prompt: [
        `Allowed categories: ${LAUNCH_CATEGORIES.map((c) => `${c.slug} (${c.description})`).join("; ")}`,
        input.name ? `Name given by the admin: ${input.name}` : null,
        input.categorySlug ? `Category chosen by the admin (use it): ${input.categorySlug}` : null,
        `Homepage URL: ${websiteUrl}`,
        `Page title: ${page.title ?? ""}`,
        `Meta description: ${page.description ?? ""}`,
        `Homepage text (truncated):\n${page.markdown.slice(0, 6000)}`,
        `Links on the page:\n${links.join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const r = res.data;
    const linkSet = new Set(links);
    const onSite = (u: URL) =>
      linkSet.has(u.toString()) || u.hostname.endsWith(new URL(websiteUrl).hostname.replace(/^www\./, ""));
    const profile = productProfileSchema.parse({
      pricingUrl: validUrl(r.pricingUrl, onSite),
      docsUrl: validUrl(r.docsUrl, (u) => linkSet.has(u.toString()) || onSite(u)),
      changelogUrl: validUrl(r.changelogUrl, (u) => linkSet.has(u.toString()) || onSite(u)),
      logoUrl: page.favicon,
      socials: Object.fromEntries(
        r.socials
          .map((s) => [s.network.toLowerCase(), validUrl(s.url, (u) => SOCIAL_HOSTS.test(u.hostname))] as const)
          .filter(([, u]) => u),
      ),
      appStores: r.appStores.map((u) => validUrl(u, (x) => STORE_HOSTS.test(x.hostname))).filter(Boolean),
    });

    const categorySlug = input.categorySlug ?? r.categorySlug;
    const [category] = await ctx.db.select().from(categories).where(eq(categories.slug, categorySlug)).limit(1);
    const { product, created } = existing
      ? { product: existing, created: false }
      : await findOrCreateProduct(ctx.db, {
          name: input.name?.trim() || r.name,
          websiteUrl,
          categoryId: category?.id ?? null,
        });
    ctx.log(created ? "created product" : "using existing product", { productId: product.id, domain: product.domain });

    const logoAssetId = product.logoAssetId ?? (await captureLogo(ctx, product, page.favicon));
    const updated = await updateProduct(ctx.db, product.id, {
      tagline: product.tagline ?? r.tagline,
      categoryId: product.categoryId ?? category?.id ?? null,
      profile: { ...product.profile, ...profile, socials: { ...product.profile?.socials, ...profile.socials } },
      logoAssetId,
    });
    const go = await ensureGoSlug(ctx.db, updated);
    await setJobLinks(ctx.db, ctx.jobId, { productId: updated.id });

    return {
      output: {
        productId: updated.id,
        slug: updated.slug,
        name: updated.name,
        websiteUrl: updated.websiteUrl,
        created,
        goSlug: go.slug,
        logoAssetId: logoAssetId ?? null,
      },
      model: res.model,
      effort: prompt.effort,
      promptVersion: prompt.version,
    };
  },
});
