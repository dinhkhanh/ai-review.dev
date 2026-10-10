import type { CostHandler } from "../cost-event";

/**
 * Generative image adapter (FR-MED-2, SRS §4.2). fal.ai Flux by default: illustrative hero and
 * section images only. Screenshots and templated graphics remain the evidence; generated images
 * must never show the vendor's logo or UI (see `buildIllustrationPrompt`).
 */
export interface GeneratedImage {
  url: string;
  width: number;
  height: number;
  contentType: string;
  model: string;
  seed: number | null;
  prompt: string;
}

export type ImageSize = "landscape_16_9" | "landscape_4_3" | "square_hd" | "portrait_4_3";

export interface ImageGenerator {
  model: string;
  generate(input: { prompt: string; size?: ImageSize; seed?: number }): Promise<GeneratedImage>;
}

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly reason: "http" | "safety" | "empty" = "http",
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

/** USD per megapixel, billed per started megapixel (fal.ai list prices, 2026-10). */
export const FAL_PRICING: Record<string, number> = {
  "fal-ai/flux/schnell": 0.003,
  "fal-ai/flux/dev": 0.025,
  "fal-ai/flux-pro/v1.1": 0.04,
};

export function falCostUsd(model: string, width: number, height: number): number {
  const megapixels = Math.max(1, Math.ceil((width * height) / 1_000_000));
  return megapixels * (FAL_PRICING[model] ?? FAL_PRICING["fal-ai/flux/schnell"]!);
}

export interface FalOptions {
  apiKey?: string;
  model?: string;
  onCost?: CostHandler;
  fetchImpl?: typeof fetch;
}

/** Returns null without FAL_KEY so callers can hide the feature instead of failing. */
export function createFalImageGenerator(options: FalOptions = {}): ImageGenerator | null {
  const apiKey = options.apiKey ?? process.env.FAL_KEY;
  if (!apiKey) return null;
  const model = options.model ?? "fal-ai/flux/schnell";
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    model,
    async generate({ prompt, size = "landscape_16_9", seed }) {
      const res = await fetchImpl(`https://fal.run/${model}`, {
        method: "POST",
        headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          image_size: size,
          num_images: 1,
          enable_safety_checker: true,
          ...(seed !== undefined ? { seed } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        throw new ImageGenerationError(
          `Image generation failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`,
          res.status,
        );
      }
      const body = (await res.json()) as {
        images?: Array<{ url: string; width?: number; height?: number; content_type?: string }>;
        seed?: number;
        has_nsfw_concepts?: boolean[];
      };
      const image = body.images?.[0];
      if (!image?.url) throw new ImageGenerationError("Image generation returned no image", res.status, "empty");
      if (body.has_nsfw_concepts?.[0]) {
        throw new ImageGenerationError("Image was rejected by the safety checker", res.status, "safety");
      }
      const width = image.width ?? 1024;
      const height = image.height ?? 576;
      if (options.onCost) {
        await options.onCost({
          provider: "fal",
          model,
          operation: "image_generate",
          units: 1,
          unitType: "images",
          costUsd: falCostUsd(model, width, height),
          meta: { width, height, size },
        });
      }
      return {
        url: image.url,
        width,
        height,
        contentType: image.content_type ?? "image/jpeg",
        model,
        seed: body.seed ?? null,
        prompt,
      };
    },
  };
}

/** Rough visual themes per launch category, so prompts describe concepts rather than products. */
const CATEGORY_THEMES: Record<string, string> = {
  "ai-tools": "neural network shapes, glowing nodes and flowing connections",
  marketing: "rising funnels, megaphone-like shapes and audience circles",
  "developer-tools": "abstract code blocks, terminals as simple geometry and connected modules",
  "hosting-servers": "server racks as stacked blocks, clouds and network links",
  productivity: "organised cards, checklists as simple shapes and calendar grids",
  "new-releases": "a launching rocket shape with stars and confetti",
};

/** Removes names that could make the model draw wordmarks or logos. */
export function stripNames(text: string, names: string[]): string {
  let out = text;
  for (const name of names.filter((n) => n.trim().length >= 2)) {
    out = out.replace(new RegExp(name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
  }
  return out
    .replace(/["“”'’]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface IllustrationInput {
  categorySlug?: string | null;
  categoryName?: string | null;
  /** Audiences/themes, e.g. the verdict's "best for" list. */
  themes?: string[];
  /** Product and competitor names: removed from the prompt (no logos or wordmarks). */
  avoidNames?: string[];
}

/**
 * Deterministic illustration prompt (FR-MED-2). A template instead of an LLM call: it costs
 * nothing, is reproducible, and the guardrails (no text, logos, UI or faces) cannot be dropped by
 * a model rewriting them. Product names are stripped so the model has nothing to render as a mark.
 */
export function buildIllustrationPrompt(input: IllustrationInput): string {
  const theme =
    (input.categorySlug && CATEGORY_THEMES[input.categorySlug]) ||
    (input.categoryName ? `the idea of ${stripNames(input.categoryName, input.avoidNames ?? [])} software` : null) ||
    "abstract software and productivity concepts";
  const audiences = (input.themes ?? [])
    .map((t) => stripNames(t, input.avoidNames ?? []))
    .filter((t) => t.length > 2)
    .slice(0, 3);
  return [
    `Editorial illustration representing ${theme}.`,
    audiences.length ? `Mood: useful for ${audiences.join(", ")}.` : "",
    "Style: flat abstract editorial illustration, geometric shapes, soft gradients, muted palette with indigo and teal accents, clean composition, plenty of negative space.",
    "Strictly no text, no letters, no numbers, no words, no logos, no brand marks, no trademarks, no app or website screenshots, no user interfaces, no human faces.",
  ]
    .filter(Boolean)
    .join(" ");
}
