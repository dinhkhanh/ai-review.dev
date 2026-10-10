import { createHash } from "node:crypto";
import { eq, mediaAssets, type DbOrTx } from "@repo/db";
import { processImage } from "./images";
import type { StorageDriver } from "./storage";

type MediaKind = (typeof mediaAssets.kind.enumValues)[number];
type MediaOrigin = (typeof mediaAssets.origin.enumValues)[number];

export interface SaveImageInput {
  bytes: Buffer;
  kind: MediaKind;
  origin: MediaOrigin;
  /** Key prefix, e.g. `products/<id>/screenshots`. The file name is the content hash. */
  prefix: string;
  role?: string | null;
  alt?: string | null;
  productId?: string | null;
  articleId?: string | null;
  licenseNote?: string | null;
  capturedAt?: Date | null;
  lossless?: boolean;
  /** Original asset this one was derived from (processed screenshots, FR-MED-3). */
  parentAssetId?: string | null;
}

export type MediaAssetRow = typeof mediaAssets.$inferSelect;

/**
 * Processes an image into WebP + variants, uploads everything, and records one media asset
 * (FR-MED-4). Content-addressed keys make re-runs idempotent: the same bytes reuse the same row.
 */
export async function saveImageAsset(
  db: DbOrTx,
  storage: StorageDriver,
  input: SaveImageInput,
): Promise<MediaAssetRow> {
  const hash = createHash("sha256").update(input.bytes).digest("hex").slice(0, 24);
  const key = `${input.prefix.replace(/\/$/, "")}/${hash}.webp`;
  const [existing] = await db.select().from(mediaAssets).where(eqKey(key)).limit(1);
  if (existing) return existing;

  const processed = await processImage(input.bytes, { lossless: input.lossless });
  await storage.put(key, processed.original.bytes, processed.original.mimeType);
  const variants: MediaAssetRow["variants"] = {};
  for (const [name, img] of Object.entries(processed.variants)) {
    const variantKey = `${input.prefix.replace(/\/$/, "")}/${hash}-${name}.webp`;
    await storage.put(variantKey, img.bytes, img.mimeType);
    variants[name] = { key: variantKey, width: img.width, height: img.height, mime: img.mimeType };
  }
  const [row] = await db
    .insert(mediaAssets)
    .values({
      kind: input.kind,
      origin: input.origin,
      storage: storage.kind,
      storageKey: key,
      mimeType: processed.original.mimeType,
      width: processed.original.width,
      height: processed.original.height,
      bytes: processed.original.bytes.length,
      variants,
      alt: input.alt ?? null,
      role: input.role ?? null,
      productId: input.productId ?? null,
      articleId: input.articleId ?? null,
      licenseNote: input.licenseNote ?? null,
      capturedAt: input.capturedAt ?? null,
      parentAssetId: input.parentAssetId ?? null,
    })
    .onConflictDoNothing({ target: mediaAssets.storageKey })
    .returning();
  if (row) return row;
  const [raced] = await db.select().from(mediaAssets).where(eqKey(key)).limit(1);
  return raced!;
}

function eqKey(key: string) {
  return eq(mediaAssets.storageKey, key);
}

/** Downloads a remote image (e.g. a Firecrawl screenshot URL) with a size cap. */
export async function downloadImage(
  url: string,
  maxBytes = 15 * 1024 * 1024,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.startsWith("image/") && !type.includes("octet-stream")) {
    throw new Error(`Not an image: ${type}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`Image too large: ${buf.length} bytes`);
  return buf;
}
