import sharp, { type Sharp } from "sharp";

/** Variant widths (FR-MED-4). Never upscaled. */
export const VARIANT_WIDTHS = { thumb: 320, card: 800, full: 1600 } as const;
export type VariantName = keyof typeof VARIANT_WIDTHS;

export interface EncodedImage {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface ProcessedImage {
  original: EncodedImage;
  variants: Partial<Record<VariantName, EncodedImage>>;
}

/**
 * Normalises an image to WebP and produces width variants. Graphics (`lossless`) keep crisp text;
 * screenshots use lossy WebP to stay small.
 */
export async function processImage(input: Buffer, opts: { lossless?: boolean } = {}): Promise<ProcessedImage> {
  const encode = (img: Sharp) =>
    img
      .webp(opts.lossless ? { lossless: true, effort: 4 } : { quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });

  const base = sharp(input, { failOn: "error" }).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const original = await encode(base.clone());
  const variants: ProcessedImage["variants"] = {};
  for (const [name, w] of Object.entries(VARIANT_WIDTHS) as Array<[VariantName, number]>) {
    if (width && w >= width) continue;
    const out = await encode(base.clone().resize({ width: w, withoutEnlargement: true }));
    variants[name] = { bytes: out.data, mimeType: "image/webp", width: out.info.width, height: out.info.height };
  }
  return {
    original: {
      bytes: original.data,
      mimeType: "image/webp",
      width: original.info.width,
      height: original.info.height,
    },
    variants,
  };
}
