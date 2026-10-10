import type { Image } from "@repo/contracts";
import { mediaUrl, urlForKey, type MediaRef } from "@repo/media/urls";

type Asset = MediaRef & { id: string; alt: string | null; width: number | null; height: number | null };

/** Media asset → API image with resolved variant URLs (NFR-13: no web-only HTML, just URLs). */
export function toImage(asset: Asset | null | undefined): Image | null {
  if (!asset) return null;
  return {
    url: mediaUrl(asset, asset.variants?.full ? "full" : undefined),
    width: asset.width,
    height: asset.height,
    alt: asset.alt,
    variants: Object.values(asset.variants ?? {})
      .sort((a, b) => a.width - b.width)
      .map((v) => ({ url: urlForKey(asset.storage, v.key), width: v.width, height: v.height })),
  };
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const webUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Edge cache headers with tags matching the web revalidation scheme (FR-API-2). */
export function cacheHeaders(c: { header: (k: string, v: string) => void }, tags: string[], maxAge = 300) {
  c.header("Cache-Control", `public, s-maxage=${maxAge}, stale-while-revalidate=86400`);
  c.header("Cache-Tag", tags.join(","));
}
