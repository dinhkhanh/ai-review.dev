import {
  articleBodySchema,
  slugify,
  socialSnippetsSchema,
  type ArticleBody,
  type SocialSnippets,
  type FactCheckReport,
  type QaScorecard,
  type Seo,
  type SeoBrief,
} from "@repo/content";
import {
  and,
  articleComments,
  articleVersions,
  articles,
  asc,
  count,
  desc,
  eq,
  factSheets,
  gte,
  inArray,
  ne,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { DomainError } from "./errors";
import { refreshArticleSearchText } from "./search";
import { getSetting } from "./settings";

type ArticleType = (typeof articles.type.enumValues)[number];
export type ArticleStatus = (typeof articles.status.enumValues)[number];

/**
 * Review state machine (FR-QA-2). Publishing is a separate action because it also checks gates
 * and the daily cadence cap.
 */
export const ARTICLE_TRANSITIONS: Record<ArticleStatus, ArticleStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["changes_requested", "approved", "draft", "archived"],
  changes_requested: ["in_review", "draft", "archived"],
  approved: ["scheduled", "published", "changes_requested", "in_review", "archived"],
  scheduled: ["published", "approved", "changes_requested", "archived"],
  published: ["in_review", "archived"],
  archived: ["draft"],
};

export function canTransition(from: ArticleStatus, to: ArticleStatus): boolean {
  return ARTICLE_TRANSITIONS[from].includes(to);
}

export async function getArticle(db: DbOrTx, id: string) {
  const [row] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  return row ?? null;
}

export async function findArticleForProduct(db: DbOrTx, productId: string, type: ArticleType = "review") {
  const [row] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.productId, productId), eq(articles.type, type)))
    .orderBy(asc(articles.createdAt))
    .limit(1);
  return row ?? null;
}

async function uniqueArticleSlug(db: DbOrTx, type: ArticleType, base: string, locale: string, exceptId?: string) {
  const root = slugify(base) || "review";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const [hit] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          eq(articles.type, type),
          eq(articles.slug, candidate),
          eq(articles.locale, locale),
          exceptId ? ne(articles.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    if (!hit) return candidate;
  }
  throw new DomainError("conflict", `Could not allocate a unique slug for ${root}`);
}

export interface CreateArticleInput {
  type: ArticleType;
  productId: string | null;
  productIds?: string[];
  title: string;
  slug: string;
  locale?: string;
  authorId?: string | null;
  brief?: SeoBrief | null;
  /** Category of a best-of or alternatives list (FR-CON-8). */
  categoryId?: string | null;
}

export async function createArticle(db: DbOrTx, input: CreateArticleInput) {
  const locale = input.locale ?? "en";
  const slug = await uniqueArticleSlug(db, input.type, input.slug, locale);
  const [row] = await db
    .insert(articles)
    .values({
      type: input.type,
      productId: input.productId,
      productIds: input.productIds ?? (input.productId ? [input.productId] : []),
      title: input.title,
      slug,
      locale,
      authorId: input.authorId ?? null,
      brief: input.brief ?? null,
      categoryId: input.categoryId ?? null,
    })
    .returning();
  return row!;
}

export async function updateArticleMeta(
  db: DbOrTx,
  id: string,
  patch: Partial<Pick<typeof articles.$inferInsert, "title" | "authorId" | "brief" | "lastVerifiedAt">> & {
    slug?: string;
  },
) {
  const current = await getArticle(db, id);
  if (!current) throw new DomainError("not_found", `Article ${id} not found`);
  const slug =
    patch.slug && patch.slug !== current.slug
      ? current.status === "published"
        ? (() => {
            throw new DomainError("conflict", "Published articles keep their slug (canonical URL)");
          })()
        : await uniqueArticleSlug(db, current.type, patch.slug, current.locale, id)
      : undefined;
  const [row] = await db
    .update(articles)
    .set({ ...patch, ...(slug ? { slug } : {}) })
    .where(eq(articles.id, id))
    .returning();
  return row!;
}

export interface NewVersionInput {
  blocks: ArticleBody;
  seo?: Seo | null;
  overallScore?: number | null;
  qaScorecard?: QaScorecard | null;
  factCheck?: FactCheckReport | null;
  promptVersions?: Record<string, string> | null;
  jobId?: string | null;
  userId?: string | null;
  changeNote?: string | null;
}

/** Appends an immutable version and makes it current (FR-CON-11). */
export async function addArticleVersion(db: DbOrTx, articleId: string, input: NewVersionInput) {
  const blocks = articleBodySchema.parse(input.blocks);
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ version: articleVersions.version })
      .from(articleVersions)
      .where(eq(articleVersions.articleId, articleId))
      .orderBy(desc(articleVersions.version))
      .limit(1);
    const [row] = await tx
      .insert(articleVersions)
      .values({
        articleId,
        version: (last?.version ?? 0) + 1,
        blocks,
        seo: input.seo ?? null,
        overallScore: input.overallScore ?? null,
        qaScorecard: input.qaScorecard ?? null,
        factCheck: input.factCheck ?? null,
        promptVersions: input.promptVersions ?? null,
        createdByJobId: input.jobId ?? null,
        createdByUserId: input.userId ?? null,
        changeNote: input.changeNote ?? null,
      })
      .returning();
    await tx.update(articles).set({ currentVersionId: row!.id }).where(eq(articles.id, articleId));
    return row!;
  });
}

export async function getVersion(db: DbOrTx, versionId: string) {
  const [row] = await db.select().from(articleVersions).where(eq(articleVersions.id, versionId)).limit(1);
  return row ?? null;
}

export async function getCurrentVersion(db: DbOrTx, articleId: string) {
  const article = await getArticle(db, articleId);
  if (!article?.currentVersionId) return null;
  return getVersion(db, article.currentVersionId);
}

export async function listVersions(db: DbOrTx, articleId: string) {
  return db
    .select({
      id: articleVersions.id,
      version: articleVersions.version,
      overallScore: articleVersions.overallScore,
      createdByJobId: articleVersions.createdByJobId,
      createdByUserId: articleVersions.createdByUserId,
      changeNote: articleVersions.changeNote,
      createdAt: articleVersions.createdAt,
    })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, articleId))
    .orderBy(desc(articleVersions.version));
}

/** Rolls back by copying an old version forward, so history stays append-only. */
export async function rollbackToVersion(db: DbOrTx, articleId: string, versionId: string, userId?: string | null) {
  const old = await getVersion(db, versionId);
  if (!old || old.articleId !== articleId) throw new DomainError("not_found", "Version not found for this article");
  return addArticleVersion(db, articleId, {
    blocks: old.blocks,
    seo: old.seo,
    overallScore: old.overallScore,
    qaScorecard: old.qaScorecard,
    factCheck: old.factCheck,
    promptVersions: old.promptVersions,
    userId,
    changeNote: `Rollback to v${old.version}`,
  });
}

/** QA results are computed metadata on a version, not content, so they may be attached later. */
export async function setVersionQa(
  db: DbOrTx,
  versionId: string,
  qa: { qaScorecard?: QaScorecard; factCheck?: FactCheckReport; seo?: Seo },
) {
  await db
    .update(articleVersions)
    .set({
      ...(qa.qaScorecard ? { qaScorecard: qa.qaScorecard } : {}),
      ...(qa.factCheck ? { factCheck: qa.factCheck } : {}),
      ...(qa.seo ? { seo: qa.seo } : {}),
    })
    .where(eq(articleVersions.id, versionId));
}

export async function transitionArticle(
  db: DbOrTx,
  articleId: string,
  to: ArticleStatus,
  opts: { scheduledFor?: Date | null } = {},
) {
  const article = await getArticle(db, articleId);
  if (!article) throw new DomainError("not_found", `Article ${articleId} not found`);
  if (to === "published") throw new DomainError("invalid", "Use publishArticle() to publish");
  if (!canTransition(article.status, to)) {
    throw new DomainError("invalid", `Cannot move an article from ${article.status} to ${to}`);
  }
  if (to === "scheduled" && !opts.scheduledFor) throw new DomainError("invalid", "Scheduling needs a date");
  const [row] = await db
    .update(articles)
    .set({ status: to, scheduledFor: to === "scheduled" ? opts.scheduledFor! : null })
    .where(eq(articles.id, articleId))
    .returning();
  return row!;
}

/** Articles published since 00:00 UTC, for the cadence cap (NFR-10, D-7). */
export async function publishedToday(db: DbOrTx, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [row] = await db
    .select({ n: count() })
    .from(articles)
    .where(and(eq(articles.status, "published"), gte(articles.publishedAt, start)));
  return row?.n ?? 0;
}

/**
 * Publishes an approved/scheduled article (C-6, FR-QA-2): the current version must pass the hard
 * gates, and first publications respect the daily cap. Republishing an edit skips the cap.
 */
export async function publishArticle(db: DbOrTx, articleId: string, opts: { now?: Date; ignoreCap?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const article = await getArticle(db, articleId);
  if (!article) throw new DomainError("not_found", `Article ${articleId} not found`);
  if (article.status !== "approved" && article.status !== "scheduled") {
    throw new DomainError(
      "invalid",
      `Only approved or scheduled articles can be published (status: ${article.status})`,
    );
  }
  const version = article.currentVersionId ? await getVersion(db, article.currentVersionId) : null;
  if (!version) throw new DomainError("invalid", "Article has no content yet");
  if (!version.qaScorecard?.hardGatesPassed) {
    throw new DomainError("invalid", "The current version has not passed the quality gates");
  }
  if (!article.publishedAt && !opts.ignoreCap) {
    const cap = (await getSetting(db, "publishing.dailyCap")) ?? 5;
    if ((await publishedToday(db, now)) >= cap) {
      throw new DomainError("conflict", `Daily publishing cap reached (${cap}); schedule it for tomorrow instead`);
    }
  }
  const researchedAt = await factsVerifiedAt(db, article.productIds.length ? article.productIds : [article.productId]);
  const verified = [article.lastVerifiedAt, researchedAt].filter((d): d is Date => !!d);
  const [row] = await db
    .update(articles)
    .set({
      status: "published",
      publishedVersionId: version.id,
      publishedAt: article.publishedAt ?? now,
      scheduledFor: null,
      // "Facts verified" follows the latest research behind the published version (FR-MNT-2).
      lastVerifiedAt: verified.length ? new Date(Math.max(...verified.map((d) => d.getTime()))) : now,
    })
    .where(eq(articles.id, articleId))
    .returning();
  if (article.productId) {
    await db.update(products).set({ status: "active" }).where(eq(products.id, article.productId));
  }
  await refreshArticleSearchText(db, articleId);
  return row!;
}

/**
 * When the facts behind an article were last researched: the oldest of its products' latest fact
 * sheets (a comparison is only as fresh as its stalest product). Null when none has a fact sheet.
 */
export async function factsVerifiedAt(db: DbOrTx, productIds: Array<string | null>): Promise<Date | null> {
  const ids = productIds.filter((x): x is string => !!x);
  if (ids.length === 0) return null;
  const rows = await db
    .select({ productId: factSheets.productId, at: sql<string>`max(${factSheets.createdAt})` })
    .from(factSheets)
    .where(inArray(factSheets.productId, ids))
    .groupBy(factSheets.productId);
  if (rows.length < ids.length) return null;
  return new Date(Math.min(...rows.map((r) => new Date(r.at).getTime())));
}

/** Bumps "facts verified" without a new version, when a refresh found nothing material (FR-MNT-1). */
export async function markArticleVerified(db: DbOrTx, articleId: string, at = new Date()) {
  await db.update(articles).set({ lastVerifiedAt: at }).where(eq(articles.id, articleId));
}

/** Scheduled articles whose time has come (run by a cron). */
export async function dueScheduledArticles(db: DbOrTx, now = new Date()) {
  return db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.status, "scheduled"), sql`${articles.scheduledFor} <= ${now.toISOString()}::timestamptz`));
}

export async function listArticles(
  db: DbOrTx,
  opts: { status?: ArticleStatus[]; locale?: string | null; limit?: number } = {},
) {
  return db
    .select({
      id: articles.id,
      type: articles.type,
      slug: articles.slug,
      locale: articles.locale,
      translationOfId: articles.translationOfId,
      title: articles.title,
      status: articles.status,
      productId: articles.productId,
      productName: products.name,
      publishedAt: articles.publishedAt,
      updatedAt: articles.updatedAt,
      overallScore: articleVersions.overallScore,
      hardGatesPassed: sql<boolean | null>`(${articleVersions.qaScorecard} ->> 'hardGatesPassed')::boolean`,
    })
    .from(articles)
    .leftJoin(products, eq(products.id, articles.productId))
    .leftJoin(articleVersions, eq(articleVersions.id, articles.currentVersionId))
    .where(
      and(
        opts.status?.length ? inArray(articles.status, opts.status) : undefined,
        opts.locale ? eq(articles.locale, opts.locale) : undefined,
      ),
    )
    .orderBy(desc(articles.updatedAt))
    .limit(Math.min(opts.limit ?? 100, 500));
}

export async function addComment(
  db: DbOrTx,
  input: {
    articleId: string;
    versionId?: string | null;
    blockId?: string | null;
    body: string;
    userId?: string | null;
  },
) {
  const body = input.body.trim();
  if (!body) throw new DomainError("invalid", "Comment is empty");
  const [row] = await db
    .insert(articleComments)
    .values({
      articleId: input.articleId,
      versionId: input.versionId ?? null,
      blockId: input.blockId ?? null,
      body,
      authorUserId: input.userId ?? null,
    })
    .returning();
  return row!;
}

export async function listComments(db: DbOrTx, articleId: string) {
  return db
    .select()
    .from(articleComments)
    .where(eq(articleComments.articleId, articleId))
    .orderBy(asc(articleComments.createdAt));
}

export async function resolveComment(db: DbOrTx, commentId: string, resolved = true) {
  await db.update(articleComments).set({ resolved }).where(eq(articleComments.id, commentId));
}

/**
 * Article id for a slug (click and conversion attribution). Without a type, any article type
 * matches, reviews first: SubIDs carry only the slug (FR-AFF-7, FR-AFF-12).
 */
export async function getArticleIdBySlug(db: DbOrTx, slug: string, type?: ArticleType) {
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.slug, slug), type ? eq(articles.type, type) : undefined))
    .orderBy(sql`(${articles.type} = 'review') desc`, asc(articles.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Stores generated social posts on the article (FR-CON-8). */
export async function setArticleSocial(db: DbOrTx, articleId: string, social: SocialSnippets) {
  await db
    .update(articles)
    .set({ social: socialSnippetsSchema.parse(social) })
    .where(eq(articles.id, articleId));
}
