import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, productSources, researchChunks, sql, type DbOrTx } from "@repo/db";

type SourceKind = (typeof productSources.kind.enumValues)[number];

export interface UpsertSourceInput {
  productId: string;
  url: string;
  kind: SourceKind;
  title?: string | null;
  httpStatus?: number | null;
  robotsAllowed?: boolean | null;
  contentMd?: string | null;
  screenshotAssetId?: string | null;
  jobId?: string | null;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** Stores a fetched page as a source (FR-RES-1/2). Re-fetching the same URL updates it in place. */
export async function upsertSource(db: DbOrTx, input: UpsertSourceInput) {
  const values = {
    productId: input.productId,
    url: input.url,
    kind: input.kind,
    title: input.title ?? null,
    httpStatus: input.httpStatus ?? null,
    robotsAllowed: input.robotsAllowed ?? null,
    contentMd: input.contentMd ?? null,
    contentHash: input.contentMd ? contentHash(input.contentMd) : null,
    screenshotAssetId: input.screenshotAssetId ?? null,
    createdByJobId: input.jobId ?? null,
    fetchedAt: new Date(),
  };
  const [row] = await db
    .insert(productSources)
    .values(values)
    .onConflictDoUpdate({
      target: [productSources.productId, productSources.url],
      set: {
        kind: values.kind,
        title: values.title,
        httpStatus: values.httpStatus,
        robotsAllowed: values.robotsAllowed,
        contentMd: values.contentMd,
        contentHash: values.contentHash,
        createdByJobId: values.createdByJobId,
        fetchedAt: values.fetchedAt,
        ...(input.screenshotAssetId ? { screenshotAssetId: input.screenshotAssetId } : {}),
      },
    })
    .returning();
  return row!;
}

export async function setSourceScreenshot(db: DbOrTx, sourceId: string, assetId: string) {
  await db.update(productSources).set({ screenshotAssetId: assetId }).where(eq(productSources.id, sourceId));
}

/** Sources in a stable order; their 1-based position is the "S<n>" ref used in prompts and the editor. */
export async function listSources(db: DbOrTx, productId: string, opts: { withContent?: boolean } = {}) {
  const rows = await db
    .select()
    .from(productSources)
    .where(eq(productSources.productId, productId))
    .orderBy(asc(productSources.createdAt), asc(productSources.id));
  return opts.withContent ? rows : rows.map((r) => ({ ...r, contentMd: null }));
}

export async function getSourcesByIds(db: DbOrTx, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(productSources).where(inArray(productSources.id, ids));
}

/** Stable `S<n>` refs for a product's sources (citation shorthand for prompts and the CMS editor). */
export function sourceRefs(sources: Array<{ id: string }>) {
  const toRef = new Map<string, string>();
  const toId = new Map<string, string>();
  sources.forEach((s, i) => {
    toRef.set(s.id, `S${i + 1}`);
    toId.set(`S${i + 1}`, s.id);
  });
  return {
    ref: (id: string) => toRef.get(id) ?? id,
    id: (ref: string) => toId.get(ref.toUpperCase()) ?? (toRef.has(ref) ? ref : null),
  };
}

export async function replaceChunks(
  db: DbOrTx,
  source: { id: string; productId: string },
  chunks: Array<{ text: string; tokenCount: number }>,
) {
  await db.transaction(async (tx) => {
    await tx.delete(researchChunks).where(eq(researchChunks.sourceId, source.id));
    if (chunks.length === 0) return;
    await tx.insert(researchChunks).values(
      chunks.map((c, ord) => ({
        sourceId: source.id,
        productId: source.productId,
        ord,
        text: c.text,
        tokenCount: c.tokenCount,
      })),
    );
  });
}

export async function listChunksMissingEmbeddings(db: DbOrTx, productId: string, limit = 500) {
  return db
    .select({ id: researchChunks.id, text: researchChunks.text })
    .from(researchChunks)
    .where(and(eq(researchChunks.productId, productId), isNull(researchChunks.embedding)))
    .orderBy(asc(researchChunks.sourceId), asc(researchChunks.ord))
    .limit(limit);
}

export async function setChunkEmbedding(db: DbOrTx, chunkId: string, embedding: number[]) {
  await db.update(researchChunks).set({ embedding }).where(eq(researchChunks.id, chunkId));
}

export async function countChunks(db: DbOrTx, productId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, embedded: sql<number>`count(${researchChunks.embedding})::int` })
    .from(researchChunks)
    .where(eq(researchChunks.productId, productId));
  return { total: row?.n ?? 0, embedded: row?.embedded ?? 0 };
}

const STOP = new Set(
  "the and for with that this from are was were has have had its it's our your their you they them what which when where who how why can will would should could into over under than then also only just more most very such each per via about across been being does did not but all any".split(
    " ",
  ),
);

/**
 * Full-text query from free text: OR of distinctive terms, so long sentences still match chunks
 * that share some of their words (ranking rewards chunks matching more of them).
 */
export function orTsQuery(text: string, maxTerms = 24): string | null {
  const terms = [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9$€£%.\s-]/g, " ")
        .split(/\s+/)
        .map((t) => t.replace(/^[.-]+|[.-]+$/g, "").replace(/[$€£%]/g, ""))
        .filter((t) => t.length >= 3 && !STOP.has(t) && /^[a-z0-9.-]+$/.test(t)),
    ),
  ].slice(0, maxTerms);
  return terms.length ? terms.map((t) => `'${t.replace(/'/g, "")}'`).join(" | ") : null;
}

export interface ChunkHit {
  id: string;
  sourceId: string;
  ord: number;
  text: string;
  score: number;
}

/**
 * Retrieval over a product's research chunks (FR-RES-3): cosine similarity when a query embedding
 * is given, Postgres full-text ranking otherwise.
 */
export async function searchChunks(
  db: DbOrTx,
  productId: string,
  opts: { query: string; embedding?: number[] | null; limit?: number; sourceIds?: string[] },
): Promise<ChunkHit[]> {
  const limit = opts.limit ?? 8;
  const scope = and(
    eq(researchChunks.productId, productId),
    opts.sourceIds?.length ? inArray(researchChunks.sourceId, opts.sourceIds) : undefined,
  );
  // Vector search only when every chunk in scope is embedded; otherwise some evidence would be invisible.
  const [missing] = opts.embedding
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(researchChunks)
        .where(and(scope, isNull(researchChunks.embedding)))
    : [{ n: 1 }];
  if (opts.embedding && missing?.n === 0) {
    const vec = `[${opts.embedding.join(",")}]`;
    const distance = sql<number>`${researchChunks.embedding} <=> ${vec}::vector`;
    const rows = await db
      .select({
        id: researchChunks.id,
        sourceId: researchChunks.sourceId,
        ord: researchChunks.ord,
        text: researchChunks.text,
        distance,
      })
      .from(researchChunks)
      .where(and(scope, sql`${researchChunks.embedding} is not null`))
      .orderBy(distance)
      .limit(limit);
    if (rows.length > 0) return rows.map(({ distance: d, ...r }) => ({ ...r, score: 1 - Number(d) }));
  }
  const q = orTsQuery(opts.query);
  if (!q) return [];
  const tsq = sql`to_tsquery('english', ${q})`;
  const rank = sql<number>`ts_rank(${researchChunks.tsv}, ${tsq})`;
  const rows = await db
    .select({
      id: researchChunks.id,
      sourceId: researchChunks.sourceId,
      ord: researchChunks.ord,
      text: researchChunks.text,
      rank,
    })
    .from(researchChunks)
    .where(and(scope, sql`${researchChunks.tsv} @@ ${tsq}`))
    .orderBy(desc(rank))
    .limit(limit);
  return rows.map(({ rank: r, ...rest }) => ({ ...rest, score: Number(r) }));
}

/** First chunks of the given sources, for prompts that need a little of everything. */
export async function leadingChunks(db: DbOrTx, sourceIds: string[], perSource = 2) {
  if (sourceIds.length === 0) return [];
  return db
    .select({
      id: researchChunks.id,
      sourceId: researchChunks.sourceId,
      ord: researchChunks.ord,
      text: researchChunks.text,
    })
    .from(researchChunks)
    .where(and(inArray(researchChunks.sourceId, sourceIds), sql`${researchChunks.ord} < ${perSource}`))
    .orderBy(asc(researchChunks.sourceId), asc(researchChunks.ord));
}
