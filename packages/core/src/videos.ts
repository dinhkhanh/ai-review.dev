import { and, articles, desc, eq, inArray, mediaAssets, mediaBlobs, ne, sql, videos, type DbOrTx } from "@repo/db";

export type VideoRow = typeof videos.$inferSelect;
export type VideoKind = (typeof videos.kind.enumValues)[number];
type VideoPatch = Partial<Omit<typeof videos.$inferInsert, "id" | "articleId" | "kind" | "createdAt">>;

/** The article's video of one kind (FR-VID-1..5: one short and one long per article). */
export async function getVideo(db: DbOrTx, articleId: string, kind: VideoKind) {
  const [row] = await db
    .select()
    .from(videos)
    .where(and(eq(videos.articleId, articleId), eq(videos.kind, kind)))
    .limit(1);
  return row ?? null;
}

export async function listVideos(db: DbOrTx, articleId: string) {
  return db.select().from(videos).where(eq(videos.articleId, articleId)).orderBy(videos.kind);
}

/** Creates or updates the article's video of `kind` (unique per article and kind). */
export async function upsertVideo(db: DbOrTx, articleId: string, kind: VideoKind, patch: VideoPatch) {
  const [row] = await db
    .insert(videos)
    .values({ articleId, kind, ...patch })
    .onConflictDoUpdate({ target: [videos.articleId, videos.kind], set: { ...patch, updatedAt: sql`now()` } })
    .returning();
  return row!;
}

/** Videos visible to the public: uploaded to YouTube (FR-VID-4). Drafts and renders stay in the CMS. */
export async function publishedVideosForArticle(db: DbOrTx, articleId: string) {
  return db
    .select()
    .from(videos)
    .where(and(eq(videos.articleId, articleId), sql`${videos.youtubeId} is not null`))
    .orderBy(desc(videos.kind));
}

/** Public, serialisable shape used by the web page, JSON-LD and the API. */
export function publicVideo(v: VideoRow) {
  return {
    kind: v.kind,
    youtubeId: v.youtubeId!,
    title: v.script?.title ?? null,
    description: v.script?.description ?? null,
    durationSeconds: v.durationSeconds,
    uploadedAt: v.publishedAt,
    embedUrl: `https://www.youtube-nocookie.com/embed/${v.youtubeId}`,
    watchUrl:
      v.kind === "short"
        ? `https://www.youtube.com/shorts/${v.youtubeId}`
        : `https://www.youtube.com/watch?v=${v.youtubeId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`,
  };
}
export type PublicVideo = ReturnType<typeof publicVideo>;

/**
 * Live articles with no video row of one of `kinds` yet (auto-generation, FR-VID-1). Failed or
 * existing rows are left to the editor so a broken article is not retried every hour.
 */
export async function articlesNeedingVideos(db: DbOrTx, kinds: VideoKind[], limit = 2) {
  if (kinds.length === 0) return [];
  const live = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(sql`${articles.publishedVersionId} is not null`, ne(articles.status, "archived")))
    .orderBy(desc(articles.publishedAt))
    .limit(200);
  if (live.length === 0) return [];
  const existing = await db
    .select({ articleId: videos.articleId, kind: videos.kind })
    .from(videos)
    .where(
      inArray(
        videos.articleId,
        live.map((a) => a.id),
      ),
    );
  const have = new Set(existing.map((v) => `${v.articleId}:${v.kind}`));
  const out: Array<{ articleId: string; kind: VideoKind }> = [];
  for (const a of live) {
    for (const kind of kinds) {
      if (!have.has(`${a.id}:${kind}`)) out.push({ articleId: a.id, kind });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Records an already-stored binary (MP4, MP3, JPEG) as a media asset; no image processing. */
export async function recordMediaFile(
  db: DbOrTx,
  input: {
    kind: (typeof mediaAssets.kind.enumValues)[number];
    origin: (typeof mediaAssets.origin.enumValues)[number];
    storage: (typeof mediaAssets.storage.enumValues)[number];
    storageKey: string;
    mimeType: string;
    bytes: number;
    width?: number | null;
    height?: number | null;
    role?: string | null;
    alt?: string | null;
    productId?: string | null;
    articleId?: string | null;
  },
) {
  const [row] = await db
    .insert(mediaAssets)
    .values({ ...input, capturedAt: new Date() })
    .onConflictDoUpdate({ target: mediaAssets.storageKey, set: { bytes: input.bytes, updatedAt: sql`now()` } })
    .returning();
  return row!;
}

/** Media rows for a video's audio/MP4/thumbnail ids (nulls skipped). */
export async function videoMedia(db: DbOrTx, v: Pick<VideoRow, "audioAssetId" | "videoAssetId" | "thumbnailAssetId">) {
  const ids = [v.audioAssetId, v.videoAssetId, v.thumbnailAssetId].filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  return db.select().from(mediaAssets).where(inArray(mediaAssets.id, ids));
}

/** Bytes of an object stored with the `db` media driver (renders read audio/screenshots back). */
export async function readMediaBlob(db: DbOrTx, key: string) {
  const [row] = await db.select().from(mediaBlobs).where(eq(mediaBlobs.key, key)).limit(1);
  return row ? { bytes: row.data, mimeType: row.mimeType } : null;
}
