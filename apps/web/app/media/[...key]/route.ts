import { getDb, eq, mediaBlobs } from "@repo/db";

/**
 * Serves media stored by the `db` storage driver (used until R2 credentials are configured).
 * Keys are content-addressed, so responses are immutable and edge-cacheable.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const storageKey = key.map(decodeURIComponent).join("/");
  if (!/^[\w./-]+$/.test(storageKey) || storageKey.includes("..")) return new Response("Not found", { status: 404 });
  const [blob] = await getDb().select().from(mediaBlobs).where(eq(mediaBlobs.key, storageKey)).limit(1);
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(blob.data), {
    headers: { "Content-Type": blob.mimeType, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
