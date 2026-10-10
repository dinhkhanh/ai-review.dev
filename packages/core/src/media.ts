import type { Block } from "@repo/content";
import {
  and,
  articles,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  mediaAssets,
  or,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { addArticleVersion, getArticle, getCurrentVersion } from "./articles";
import { DomainError } from "./errors";

type MediaKind = (typeof mediaAssets.kind.enumValues)[number];
type MediaOrigin = (typeof mediaAssets.origin.enumValues)[number];

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

export interface MediaSearch {
  /** Matches alt text, role, storage key and product name. */
  q?: string | null;
  kind?: MediaKind | null;
  origin?: MediaOrigin | null;
  productId?: string | null;
  missingAlt?: boolean;
  limit?: number;
  offset?: number;
}

/** Media library search (FR-CMS-9): newest first, with the product name and a total for paging. */
export async function searchMedia(db: DbOrTx, opts: MediaSearch = {}) {
  const q = opts.q?.trim();
  const pattern = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    pattern
      ? or(
          ilike(mediaAssets.alt, pattern),
          ilike(mediaAssets.role, pattern),
          ilike(mediaAssets.storageKey, pattern),
          ilike(products.name, pattern),
        )
      : undefined,
    opts.kind ? eq(mediaAssets.kind, opts.kind) : undefined,
    opts.origin ? eq(mediaAssets.origin, opts.origin) : undefined,
    opts.productId ? eq(mediaAssets.productId, opts.productId) : undefined,
    opts.missingAlt ? or(isNull(mediaAssets.alt), eq(mediaAssets.alt, "")) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ asset: mediaAssets, productName: products.name })
      .from(mediaAssets)
      .leftJoin(products, eq(products.id, mediaAssets.productId))
      .where(where)
      .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
      .limit(Math.min(opts.limit ?? 48, 200))
      .offset(opts.offset ?? 0),
    db.select({ n: count() }).from(mediaAssets).leftJoin(products, eq(products.id, mediaAssets.productId)).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r.asset, productName: r.productName })), total: total?.n ?? 0 };
}

export async function getMediaAsset(db: DbOrTx, id: string) {
  const [row] = await db
    .select({
      asset: mediaAssets,
      productName: products.name,
      productSlug: products.slug,
      productWebsiteUrl: products.websiteUrl,
    })
    .from(mediaAssets)
    .leftJoin(products, eq(products.id, mediaAssets.productId))
    .where(eq(mediaAssets.id, id))
    .limit(1);
  return row
    ? {
        ...row.asset,
        productName: row.productName,
        productSlug: row.productSlug,
        productWebsiteUrl: row.productWebsiteUrl,
      }
    : null;
}

/** Processed versions (framed/annotated screenshots) derived from an asset (FR-MED-3). */
export async function listMediaChildren(db: DbOrTx, parentAssetId: string) {
  return db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.parentAssetId, parentAssetId))
    .orderBy(asc(mediaAssets.createdAt));
}

export interface MediaUse {
  /** "image" block, "og" image or product "logo" (shown on the product's articles). */
  via: "image" | "og" | "logo";
  articleId: string | null;
  articleTitle: string | null;
  articleType: string | null;
  /** Which versions use it: the editor's current one, the live published one, or both. */
  inCurrent: boolean;
  inPublished: boolean;
  productId: string | null;
  productName: string | null;
}

/**
 * Where assets are used (FR-CMS-9 "used in N articles"). One query over the current and published
 * versions of every article, extracting image blocks and OG ids with jsonb functions, plus product
 * logos (which appear on all of the product's articles).
 */
export async function mediaUsage(db: DbOrTx, assetIds: string[]): Promise<Map<string, MediaUse[]>> {
  const ids = [...new Set(assetIds.filter(Boolean))];
  const out = new Map<string, MediaUse[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{
    asset_id: string;
    via: "image" | "og";
    article_id: string;
    title: string;
    type: string;
    in_current: boolean;
    in_published: boolean;
  }>(sql`
    select u.asset_id, u.via, a.id as article_id, a.title, a.type::text as type,
      bool_or(v.id = a.current_version_id) as in_current,
      bool_or(v.id = a.published_version_id) as in_published
    from articles a
    join article_versions v on v.id = a.current_version_id or v.id = a.published_version_id
    cross join lateral (
      select b ->> 'assetId' as asset_id, 'image' as via
        from jsonb_array_elements(v.blocks) b
        where b ->> 'type' = 'image' and b ->> 'assetId' in (${idList})
      union
      select v.seo ->> 'ogImageAssetId', 'og' where v.seo ->> 'ogImageAssetId' in (${idList})
    ) u
    group by u.asset_id, u.via, a.id, a.title, a.type
    order by a.title`);
  for (const r of rows) {
    out.get(r.asset_id)?.push({
      via: r.via,
      articleId: r.article_id,
      articleTitle: r.title,
      articleType: r.type,
      inCurrent: r.in_current,
      inPublished: r.in_published,
      productId: null,
      productName: null,
    });
  }
  const logos = await db
    .select({ id: products.id, name: products.name, logo: products.logoAssetId })
    .from(products)
    .where(inArray(products.logoAssetId, ids));
  for (const p of logos) {
    out.get(p.logo!)?.push({
      via: "logo",
      articleId: null,
      articleTitle: null,
      articleType: null,
      inCurrent: false,
      inPublished: false,
      productId: p.id,
      productName: p.name,
    });
  }
  return out;
}

/** Number of distinct articles using the asset (logos count the product's articles separately). */
export function articleCount(uses: MediaUse[] | undefined): number {
  return new Set((uses ?? []).flatMap((u) => (u.articleId ? [u.articleId] : []))).size;
}

/**
 * Where an inserted image goes: after the intro paragraphs, else after the verdict and its CTA,
 * else first. Never replaces existing blocks (screenshots stay).
 */
export function insertionIndex(blocks: Block[]): number {
  let lastIntro = -1;
  blocks.forEach((b, i) => {
    if (b.id.startsWith("intro-")) lastIntro = i;
  });
  if (lastIntro > -1) return lastIntro + 1;
  const verdict = blocks.findIndex((b) => b.type === "verdict");
  if (verdict > -1) return blocks[verdict + 1]?.type === "cta" ? verdict + 2 : verdict + 1;
  return 0;
}

/**
 * Adds an image block to the article as a new version (FR-MED-2 "insert", FR-CON-11). The fact
 * check carries over (no claims change); callers recompute QA for the new version.
 */
export async function insertImageIntoArticle(
  db: DbOrTx,
  input: { articleId: string; assetId: string; caption?: string | null; userId?: string | null },
) {
  const [article, version, [asset]] = await Promise.all([
    getArticle(db, input.articleId),
    getCurrentVersion(db, input.articleId),
    getMediaAssets(db, [input.assetId]),
  ]);
  if (!article || !version) throw new DomainError("not_found", "Article or version not found");
  if (!asset) throw new DomainError("not_found", "Media asset not found");
  if (asset.kind === "video" || asset.kind === "audio") throw new DomainError("invalid", "Only images can be inserted");
  if (version.blocks.some((b) => b.type === "image" && b.assetId === asset.id)) {
    throw new DomainError("conflict", "This image is already in the article");
  }
  const caption = input.caption?.trim().slice(0, 200);
  const block: Block = {
    id: `img-${asset.id.slice(0, 8)}`,
    type: "image",
    assetId: asset.id,
    ...(caption ? { caption } : {}),
  };
  const blocks = [...version.blocks];
  blocks.splice(insertionIndex(blocks), 0, block);
  return addArticleVersion(db, article.id, {
    blocks,
    seo: version.seo,
    overallScore: version.overallScore,
    factCheck: version.factCheck,
    promptVersions: version.promptVersions,
    userId: input.userId ?? null,
    changeNote: `Inserted image${asset.origin === "generated" ? " (generated)" : ""}`,
  });
}

/** Articles an asset could be inserted into: the product's articles, newest first. */
export async function articlesForProduct(db: DbOrTx, productId: string) {
  return db
    .select({ id: articles.id, title: articles.title, type: articles.type, status: articles.status })
    .from(articles)
    .where(or(eq(articles.productId, productId), sql`${productId}::uuid = any(${articles.productIds})`))
    .orderBy(desc(articles.updatedAt))
    .limit(20);
}
