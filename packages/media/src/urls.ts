/**
 * Public URLs for stored media (FR-MED-4). Free of Node/sharp imports so web pages and the API
 * can use it. R2 objects are served from NEXT_PUBLIC_MEDIA_URL; objects in the `db` fallback
 * driver are served by the web app's `/media/[...key]` route.
 */

export type StorageKind = "r2" | "db";

export interface MediaRef {
  storage: StorageKind;
  storageKey: string;
  variants?: Record<string, { key: string; width: number; height: number; mime: string }>;
  width?: number | null;
  height?: number | null;
}

export interface MediaUrlEnv {
  mediaBaseUrl?: string | null;
  siteUrl?: string | null;
}

function defaultEnv(): MediaUrlEnv {
  return {
    mediaBaseUrl: process.env.NEXT_PUBLIC_MEDIA_URL ?? null,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  };
}

export function urlForKey(storage: StorageKind, key: string, env: MediaUrlEnv = defaultEnv()): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  if (storage === "r2" && env.mediaBaseUrl) return `${env.mediaBaseUrl.replace(/\/$/, "")}/${encoded}`;
  return `${(env.siteUrl ?? "").replace(/\/$/, "")}/media/${encoded}`;
}

/** URL of a named variant ("thumb" | "card" | "full"), falling back to the original. */
export function mediaUrl(ref: MediaRef, variant?: string, env?: MediaUrlEnv): string {
  const v = variant ? ref.variants?.[variant] : undefined;
  return urlForKey(ref.storage, v?.key ?? ref.storageKey, env);
}

/** `srcset` across all variants, smallest first. */
export function mediaSrcSet(ref: MediaRef, env?: MediaUrlEnv): string {
  return Object.values(ref.variants ?? {})
    .sort((a, b) => a.width - b.width)
    .map((v) => `${urlForKey(ref.storage, v.key, env)} ${v.width}w`)
    .join(", ");
}
