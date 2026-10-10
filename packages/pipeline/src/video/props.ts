import type { VideoScript } from "@repo/content";
import type { ArticleRenderData } from "@repo/core";
import { buildTimeline, DEFAULT_THEME, VIDEO_FPS, type CaptionWord, type VideoInputProps } from "@repo/video";

export interface PropsAssets {
  /** URL the renderer can load for a media asset id (screenshots, logo), or null. */
  imageUrl: (assetId: string) => string | null;
  audioUrl: string | null;
  audioMs: number | null;
  fontUrls: { regular: string; bold: string } | null;
}

/** Article facts the scenes draw (pricing, pros/cons, comparison, verdict) — FR-VID-3. */
export function buildVideoProps(
  data: ArticleRenderData,
  script: VideoScript,
  captions: CaptionWord[],
  assets: PropsAssets,
  opts: { articleUrl: string; disclosure: string },
): VideoInputProps {
  const blocks = data.version.blocks;
  const verdict = blocks.find((b) => b.type === "verdict");
  const pricing = blocks.find((b) => b.type === "pricing_table");
  const prosCons = blocks.find((b) => b.type === "pros_cons");
  const comparison = blocks.find((b) => b.type === "comparison_table");
  const names = new Map<string, string>();
  if (data.product) names.set(data.product.id, data.product.name);
  for (const c of data.competitors) names.set(c.productId, c.name);

  const timeline = buildTimeline(
    script.scenes.map((s) => ({
      id: s.id,
      visual: s.visual,
      narration: s.narration,
      onScreenText: s.onScreenText,
      imageUrl: s.assetId ? assets.imageUrl(s.assetId) : null,
    })),
    captions,
    { fps: VIDEO_FPS, audioMs: assets.audioMs },
  );
  return {
    kind: script.kind,
    theme: DEFAULT_THEME,
    product: {
      name: data.product?.name ?? data.article.title,
      logoUrl: data.product?.logoAssetId ? assets.imageUrl(data.product.logoAssetId) : null,
      category: data.category?.name ?? null,
    },
    title: script.title,
    score: data.version.overallScore,
    verdict:
      verdict?.type === "verdict"
        ? { summary: verdict.summary, bestFor: verdict.bestFor }
        : { summary: "", bestFor: [] },
    pricing:
      pricing?.type === "pricing_table"
        ? pricing.tiers.map((t) => ({ name: t.name, price: t.price, currency: t.currency, period: t.period }))
        : [],
    pros: prosCons?.type === "pros_cons" ? prosCons.pros : [],
    cons: prosCons?.type === "pros_cons" ? prosCons.cons : [],
    comparison:
      comparison?.type === "comparison_table"
        ? { products: comparison.productIds.map((id) => names.get(id) ?? "—"), rows: comparison.rows }
        : null,
    goUrl: opts.articleUrl,
    disclosure: opts.disclosure,
    scenes: timeline.scenes,
    captions,
    audioUrl: assets.audioUrl,
    musicUrl: null,
    fontUrls: assets.fontUrls,
    durationInFrames: timeline.durationInFrames,
  };
}

/** The YouTube description (FR-VID-4): summary, links, affiliate + AI disclosure, chapters. */
export function youTubeDescription(input: {
  script: VideoScript;
  articleUrl: string;
  goUrl: string | null;
  productName: string;
  aiDisclosure: string | null;
  chapters: string[];
}): string {
  return [
    input.script.description,
    `Full review: ${input.articleUrl}`,
    ...(input.goUrl ? [`Try ${input.productName}: ${input.goUrl}`] : []),
    `Disclosure: some links above are affiliate links. If you buy through them we may earn a commission at no extra cost to you.${input.aiDisclosure ? ` ${input.aiDisclosure}` : ""} Narration is AI-generated.`,
    ...(input.chapters.length ? [`Chapters:\n${input.chapters.join("\n")}`] : []),
  ].join("\n\n");
}
