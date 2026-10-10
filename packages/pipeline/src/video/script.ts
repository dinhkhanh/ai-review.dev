import type { Llm } from "@repo/ai";
import { articleText, sceneVisualSchema, type VideoScript } from "@repo/content";
import type { ArticleRenderData } from "@repo/core";
import { countWords, DURATION_TARGETS, WORDS_PER_MINUTE } from "@repo/video";
import { z } from "zod";
import type { ResolvedPrompt } from "../prompts";

export type VideoKind = "short" | "long";

/** Model-facing script (flat, FR-VID-1). Image refs are mapped to asset ids afterwards. */
export const videoScriptDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  scenes: z.array(
    z.object({
      visual: sceneVisualSchema,
      narration: z.string(),
      onScreenText: z.string(),
      imageRef: z.string(),
    }),
  ),
});
export type VideoScriptDraft = z.infer<typeof videoScriptDraftSchema>;

/** Narration word range for a kind at 150 wpm (short 150–300 words, long 600–1200). */
export function wordRange(kind: VideoKind) {
  const t = DURATION_TARGETS[kind];
  return {
    min: Math.round((t.minSeconds / 60) * WORDS_PER_MINUTE),
    max: Math.round((t.maxSeconds / 60) * WORDS_PER_MINUTE),
  };
}

export function narrationWords(script: { scenes: Array<{ narration: string }> }) {
  return script.scenes.reduce((n, s) => n + countWords(s.narration), 0);
}

/** Images the video may show: assets of the article's image blocks, as IMG1..n refs. */
export function videoImages(data: ArticleRenderData) {
  const ids = data.version.blocks.flatMap((b) => (b.type === "image" ? [b.assetId] : []));
  return ids
    .map((id) => data.media.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m, i) => ({ ref: `IMG${i + 1}`, assetId: m.id, label: m.alt ?? m.role ?? "screenshot" }));
}

/** What the script may draw on: the article text, verdict, pricing, pros/cons and comparison. */
export function scriptPrompt(data: ArticleRenderData, kind: VideoKind, feedback?: string) {
  const { min, max } = wordRange(kind);
  const blocks = data.version.blocks;
  const pricing = blocks.find((b) => b.type === "pricing_table");
  const comparison = blocks.find((b) => b.type === "comparison_table");
  const images = videoImages(data);
  return [
    `Write the ${kind === "short" ? "SHORT vertical video (9:16, 60–120 seconds, 4–8 scenes)" : "LONG video (16:9, 4–8 minutes, 10–20 scenes)"} for our review of ${data.product?.name ?? data.article.title}.`,
    `Narration length: ${min}–${max} words in total (aim for ${Math.round((min + max) / 2)}).`,
    `Today is ${new Date().toISOString().slice(0, 10)}. Facts verified ${(data.article.lastVerifiedAt ?? data.factSheetUpdatedAt ?? new Date()).toISOString().slice(0, 10)}.`,
    `Our score: ${data.version.overallScore ?? "none"} out of 10.`,
    `Images you may show (ref | description):\n${images.map((i) => `${i.ref} | ${i.label}`).join("\n") || "(none: do not use screenshot scenes)"}`,
    `Pricing tiers listed: ${pricing?.type === "pricing_table" ? pricing.tiers.map((t) => `${t.name} ${t.price ?? "custom"} ${t.currency}/${t.period}`).join("; ") : "(none)"}`,
    `Comparison table listed: ${comparison?.type === "comparison_table" ? "yes" : "no"}`,
    `Article title: ${data.article.title}`,
    `Article text:\n${articleText(blocks).slice(0, 40_000)}`,
    ...(feedback ? [`Fix this problem with your previous attempt: ${feedback}`] : []),
  ].join("\n\n");
}

/** Maps the model draft to the stored VideoScript; unknown image refs drop to text scenes. */
export function toVideoScript(
  draft: VideoScriptDraft,
  kind: VideoKind,
  images: ReturnType<typeof videoImages>,
): VideoScript {
  const byRef = new Map(images.map((i) => [i.ref.toUpperCase(), i.assetId]));
  return {
    kind,
    title: draft.title.trim().slice(0, 100),
    description: draft.description.trim().slice(0, 4000),
    tags: draft.tags
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 30),
    scenes: draft.scenes
      .filter((s) => s.narration.trim() || s.onScreenText.trim())
      .map((s, i) => {
        const assetId = byRef.get(s.imageRef.trim().toUpperCase());
        return {
          id: `scene-${i + 1}`,
          narration: s.narration.trim(),
          onScreenText: s.onScreenText.trim().slice(0, 80),
          visual: s.visual === "screenshot" && !assetId ? "verdict" : s.visual,
          ...(s.visual === "screenshot" && assetId ? { assetId } : {}),
        };
      }),
  };
}

/**
 * Generates and validates a script (FR-VID-1). Narration outside the word range gets one retry
 * with feedback; a second miss by more than 10 % fails the stage.
 */
export async function generateVideoScript(
  llm: Llm,
  prompt: ResolvedPrompt,
  data: ArticleRenderData,
  kind: VideoKind,
): Promise<{ script: VideoScript; words: number; model: string }> {
  const { min, max } = wordRange(kind);
  const images = videoImages(data);
  let feedback: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: `video_script_${kind}`,
      maxTokens: 16_000,
      schema: videoScriptDraftSchema,
      prompt: scriptPrompt(data, kind, feedback),
    });
    const script = toVideoScript(res.data, kind, images);
    const words = narrationWords(script);
    if (script.scenes.length > 0 && words >= min && words <= max) return { script, words, model: res.model };
    if (attempt === 2 && script.scenes.length > 0 && words >= min * 0.9 && words <= max * 1.1) {
      return { script, words, model: res.model };
    }
    feedback = `the narration had ${words} words in ${script.scenes.length} scenes; it must be ${min}–${max} words.`;
  }
  throw new Error(`Video script length out of range after a retry (${feedback})`);
}
