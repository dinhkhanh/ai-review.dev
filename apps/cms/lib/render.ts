import { localePath, localizedArticlePath } from "@repo/content";
import type { ArticleRenderData } from "@repo/core";
import { mediaSrcSet, mediaUrl } from "@repo/media/urls";
import type { RenderModel } from "@repo/ui/article";

/** CMS preview model (FR-CMS-5): same renderer as the public site; links point at the live site. */
export function toPreviewModel(data: ArticleRenderData): RenderModel {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  // German articles preview with German renderer labels and /de links (phase 3).
  const locale = data.article.locale;
  const review = (slug: string) => `${site}${localizedArticlePath("review", slug, locale)}`;
  const products: RenderModel["products"] = {};
  if (data.product) products[data.product.id] = { name: data.product.name };
  for (const c of data.competitors)
    products[c.productId] = { name: c.name, href: c.reviewSlug ? review(c.reviewSlug) : null };
  for (const p of data.listProducts)
    products[p.id] = { name: p.name, href: p.reviewSlug ? review(p.reviewSlug) : null };
  return {
    blocks: data.version.blocks,
    media: Object.fromEntries(
      data.media.map((m) => [
        m.id,
        {
          url: mediaUrl(m, m.variants?.full ? "full" : undefined),
          srcSet: mediaSrcSet(m),
          width: m.width,
          height: m.height,
          alt: m.alt,
        },
      ]),
    ),
    sources: data.sources,
    products,
    goHref: (slug, placement) => `${site}/go/${slug}?p=${placement}&a=${data.article.slug}`,
    reportHref: null,
    disclosureHref: `${site}${localePath(locale, "/affiliate-disclosure")}`,
    locale,
  };
}

/** Word-level diff for the versions tab. */
export function wordDiff(a: string, b: string): Array<{ op: "same" | "add" | "del"; text: string }> {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  if (x.length * y.length > 400_000)
    return [
      { op: "del", text: a },
      { op: "add", text: b },
    ];
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Array<{ op: "same" | "add" | "del"; text: string }> = [];
  const push = (op: "same" | "add" | "del", text: string) => {
    const last = out[out.length - 1];
    if (last?.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push("same", x[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push("del", x[i++]!);
    else push("add", y[j++]!);
  }
  while (i < x.length) push("del", x[i++]!);
  while (j < y.length) push("add", y[j++]!);
  return out;
}
