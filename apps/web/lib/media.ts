import { mediaSrcSet, mediaUrl, type MediaRef } from "@repo/media/urls";
import type { RenderMedia } from "@repo/ui/article";

type AssetRow = MediaRef & { id: string; alt: string | null; width: number | null; height: number | null };

export function toRenderMedia(asset: AssetRow): RenderMedia {
  return {
    url: mediaUrl(asset, asset.variants?.full ? "full" : undefined),
    srcSet: mediaSrcSet(asset),
    width: asset.width,
    height: asset.height,
    alt: asset.alt,
  };
}

export function assetUrl(asset: MediaRef | null | undefined, variant?: string): string | null {
  return asset ? mediaUrl(asset, variant) : null;
}
