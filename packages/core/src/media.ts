import { and, desc, eq, inArray, mediaAssets, type DbOrTx } from "@repo/db";

export async function getMediaAssets(db: DbOrTx, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  return db.select().from(mediaAssets).where(inArray(mediaAssets.id, unique));
}

export async function listMedia(db: DbOrTx, opts: { productId?: string; articleId?: string; limit?: number }) {
  return db
    .select()
    .from(mediaAssets)
    .where(
      and(
        opts.productId ? eq(mediaAssets.productId, opts.productId) : undefined,
        opts.articleId ? eq(mediaAssets.articleId, opts.articleId) : undefined,
      ),
    )
    .orderBy(desc(mediaAssets.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
}

export async function updateMediaAlt(db: DbOrTx, id: string, alt: string) {
  await db
    .update(mediaAssets)
    .set({ alt: alt.slice(0, 300) })
    .where(eq(mediaAssets.id, id));
}
