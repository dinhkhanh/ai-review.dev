import {
  CONTENT_LOCALES,
  DEFAULT_CONTENT_LOCALE,
  isContentLocale,
  slugify,
  type ArticleBody,
  type ContentLocale,
  type FactCheckReport,
  type Seo,
} from "@repo/content";
import {
  and,
  articles,
  asc,
  categories,
  desc,
  eq,
  inArray,
  ne,
  products,
  reviewJobs,
  sql,
  type DbOrTx,
} from "@repo/db";
import { addArticleVersion, createArticle, getArticle, getVersion, updateArticleMeta } from "./articles";
import { DomainError } from "./errors";
import { createReviewJob } from "./jobs";
import { getSetting } from "./settings";

/**
 * Translations (phase 3 second locale). A translated article is an ordinary article in its own
 * locale whose `translation_of_id` points at the English source and whose
 * `translated_from_version_id` records the source version it reflects. When the source publishes a
 * newer version the translation is stale until re-translated (section by section, see
 * @repo/pipeline translate).
 */

/** Locales that can be translation targets (every content locale except the canonical one). */
export const TRANSLATION_LOCALES = CONTENT_LOCALES.filter((l) => l !== DEFAULT_CONTENT_LOCALE) as Exclude<
  ContentLocale,
  "en"
>[];
export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number];

export function isTranslationLocale(value: unknown): value is TranslationLocale {
  return isContentLocale(value) && value !== DEFAULT_CONTENT_LOCALE;
}

export type TranslationState =
  | "missing"
  | "in_progress"
  | "stale"
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "scheduled"
  | "published"
  | "archived";

/** Translation state shown in the CMS: an active job wins, then staleness, then the target's status. */
export function translationState(input: {
  sourcePublishedVersionId: string | null;
  target: { status: string; translatedFromVersionId: string | null } | null;
  activeJob: boolean;
}): TranslationState {
  if (input.activeJob) return "in_progress";
  if (!input.target) return "missing";
  if (input.sourcePublishedVersionId && input.target.translatedFromVersionId !== input.sourcePublishedVersionId) {
    return "stale";
  }
  return input.target.status as TranslationState;
}

const ACTIVE_JOB_STATUSES = ["queued", "running", "awaiting_approval"] as const;

/** The translation of `sourceId` into `locale`, if one exists. */
export async function findTranslation(db: DbOrTx, sourceId: string, locale: string) {
  const [row] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.translationOfId, sourceId), eq(articles.locale, locale)))
    .orderBy(asc(articles.createdAt))
    .limit(1);
  return row ?? null;
}

/** Source article and every translation of it (for the CMS panel and hreflang groups). */
export async function translationGroup(db: DbOrTx, articleId: string) {
  const article = await getArticle(db, articleId);
  if (!article) return null;
  const sourceId = article.translationOfId ?? article.id;
  const rows = await db
    .select({
      id: articles.id,
      locale: articles.locale,
      type: articles.type,
      slug: articles.slug,
      title: articles.title,
      status: articles.status,
      publishedVersionId: articles.publishedVersionId,
      translationOfId: articles.translationOfId,
      translatedFromVersionId: articles.translatedFromVersionId,
    })
    .from(articles)
    .where(sql`${articles.id} = ${sourceId} or ${articles.translationOfId} = ${sourceId}`);
  const source = rows.find((r) => r.id === sourceId) ?? null;
  const jobs = await activeTranslationJobs(db, [sourceId]);
  const translations = rows
    .filter((r) => r.id !== sourceId)
    .map((r) => ({
      ...r,
      state: translationState({
        sourcePublishedVersionId: source?.publishedVersionId ?? null,
        target: r,
        activeJob: jobs.some((j) => j.locale === r.locale),
      }),
    }));
  const missing = TRANSLATION_LOCALES.filter((l) => !translations.some((t) => t.locale === l)).map((locale) => ({
    locale,
    state: (jobs.some((j) => j.locale === locale) ? "in_progress" : "missing") as TranslationState,
  }));
  return { source, translations, missing, isSource: article.id === sourceId };
}

/** Active (queued/running/paused) translate jobs for the given sources. */
export async function activeTranslationJobs(db: DbOrTx, sourceIds: string[]) {
  if (sourceIds.length === 0) return [];
  const rows = await db
    .select({ id: reviewJobs.id, status: reviewJobs.status, input: reviewJobs.input, runId: reviewJobs.runId })
    .from(reviewJobs)
    .where(
      and(
        eq(reviewJobs.preset, "translate"),
        inArray(reviewJobs.status, [...ACTIVE_JOB_STATUSES]),
        inArray(sql<string>`${reviewJobs.input} ->> 'sourceArticleId'`, sourceIds),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    runId: r.runId,
    sourceArticleId: String(r.input.sourceArticleId),
    locale: String(r.input.locale),
  }));
}

/**
 * Queues a translate job (preset "translate"). Re-uses an active job for the same source and
 * locale, so double clicks and the publish hook never translate twice. The source must be an
 * English article with a published version (translations follow what readers see).
 */
export async function createTranslationJob(
  db: DbOrTx,
  input: {
    sourceArticleId: string;
    locale: string;
    userId?: string | null;
    trigger?: string;
    /** Re-translate every block, discarding editor edits in the translation. */
    full?: boolean;
  },
): Promise<{ job: { id: string }; created: boolean }> {
  if (!isTranslationLocale(input.locale)) throw new DomainError("invalid", `Unsupported locale: ${input.locale}`);
  const source = await getArticle(db, input.sourceArticleId);
  if (!source) throw new DomainError("not_found", "Article not found");
  if (source.locale !== DEFAULT_CONTENT_LOCALE || source.translationOfId) {
    throw new DomainError("invalid", "Only English source articles can be translated");
  }
  if (!source.publishedVersionId) {
    throw new DomainError("invalid", "Publish the English article before translating it");
  }
  const [active] = await activeTranslationJobs(db, [source.id]).then((jobs) =>
    jobs.filter((j) => j.locale === input.locale),
  );
  if (active) return { job: { id: active.id }, created: false };
  const job = await createReviewJob(db, {
    preset: "translate",
    productId: source.productId,
    requestedByUserId: input.userId ?? null,
    input: {
      sourceArticleId: source.id,
      locale: input.locale,
      name: source.title,
      trigger: input.trigger ?? "manual",
      ...(input.full ? { full: true } : {}),
    },
  });
  return { job, created: true };
}

/**
 * Publish hook: queues translations listed in `i18n.policy.autoTranslate` for a published English
 * article, unless the translation already reflects the published version. Returns new job ids for
 * the caller to dispatch (the worker's `translation-dispatch` cron picks up the rest).
 */
export async function queueAutoTranslations(db: DbOrTx, articleId: string): Promise<string[]> {
  const article = await getArticle(db, articleId);
  if (!article?.publishedVersionId || article.locale !== DEFAULT_CONTENT_LOCALE || article.translationOfId) return [];
  const policy = await getSetting(db, "i18n.policy");
  const created: string[] = [];
  for (const locale of policy?.autoTranslate ?? []) {
    const existing = await findTranslation(db, article.id, locale);
    if (existing?.translatedFromVersionId === article.publishedVersionId) continue;
    const { job, created: isNew } = await createTranslationJob(db, {
      sourceArticleId: article.id,
      locale,
      trigger: "auto_publish",
    });
    if (isNew) created.push(job.id);
  }
  return created;
}

/**
 * Published English articles whose auto-translation is missing or stale and has no active job,
 * oldest first. The dispatch cron creates jobs for these (capped per run) so enabling
 * auto-translate also back-fills the catalogue gradually.
 */
export async function pendingAutoTranslations(db: DbOrTx, limit = 5) {
  const policy = await getSetting(db, "i18n.policy");
  const out: Array<{ sourceArticleId: string; locale: string }> = [];
  for (const locale of policy?.autoTranslate ?? []) {
    const rows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          sourceArticlesWhere(),
          sql`not exists (select 1 from ${articles} t where t.translation_of_id = ${articles.id} and t.locale = ${locale} and t.translated_from_version_id = ${articles.publishedVersionId})`,
        ),
      )
      .orderBy(asc(articles.publishedAt))
      .limit(limit * 3);
    const busy = new Set(
      (
        await activeTranslationJobs(
          db,
          rows.map((r) => r.id),
        )
      ).map((j) => j.sourceArticleId),
    );
    for (const r of rows) if (!busy.has(r.id)) out.push({ sourceArticleId: r.id, locale });
  }
  return out.slice(0, limit);
}

/** Queued translate jobs that were never handed to the worker (no run id), oldest first. */
export async function undispatchedTranslationJobs(db: DbOrTx, limit = 20) {
  return db
    .select({ id: reviewJobs.id })
    .from(reviewJobs)
    .where(and(eq(reviewJobs.preset, "translate"), eq(reviewJobs.status, "queued"), sql`${reviewJobs.runId} is null`))
    .orderBy(asc(reviewJobs.createdAt))
    .limit(limit);
}

/** English, untranslated-source articles that have been published at least once and are not archived. */
function sourceArticlesWhere() {
  return and(
    eq(articles.locale, DEFAULT_CONTENT_LOCALE),
    sql`${articles.translationOfId} is null`,
    sql`${articles.publishedVersionId} is not null`,
    ne(articles.status, "archived"),
  );
}

export interface CoverageRow {
  sourceId: string;
  type: string;
  slug: string;
  title: string;
  sourceStatus: string;
  sourcePublishedAt: Date | null;
  productName: string | null;
  target: { id: string; title: string; slug: string; status: string } | null;
  state: TranslationState;
  jobId: string | null;
}

/** Coverage matrix for the CMS: every English article that has been published × its `locale` translation. */
export async function translationCoverage(db: DbOrTx, locale: string, opts: { limit?: number } = {}) {
  if (!isTranslationLocale(locale)) throw new DomainError("invalid", `Unsupported locale: ${locale}`);
  const rows = await db
    .select({
      sourceId: articles.id,
      type: articles.type,
      slug: articles.slug,
      title: articles.title,
      sourceStatus: articles.status,
      sourcePublishedAt: articles.publishedAt,
      sourcePublishedVersionId: articles.publishedVersionId,
      productName: products.name,
    })
    .from(articles)
    .leftJoin(products, eq(products.id, articles.productId))
    .where(sourceArticlesWhere())
    .orderBy(desc(articles.publishedAt))
    .limit(Math.min(opts.limit ?? 300, 1000));
  const targets = rows.length
    ? await db
        .select({
          id: articles.id,
          title: articles.title,
          slug: articles.slug,
          status: articles.status,
          translationOfId: articles.translationOfId,
          translatedFromVersionId: articles.translatedFromVersionId,
        })
        .from(articles)
        .where(
          and(
            eq(articles.locale, locale),
            inArray(
              articles.translationOfId,
              rows.map((r) => r.sourceId),
            ),
          ),
        )
    : [];
  const jobs = await activeTranslationJobs(
    db,
    rows.map((r) => r.sourceId),
  ).then((all) => all.filter((j) => j.locale === locale));
  return rows.map((r): CoverageRow => {
    const job = jobs.find((j) => j.sourceArticleId === r.sourceId) ?? null;
    const t = targets.find((x) => x.translationOfId === r.sourceId);
    const targetRow = t ? { id: t.id, title: t.title, slug: t.slug, status: t.status } : null;
    return {
      sourceId: r.sourceId,
      type: r.type,
      slug: r.slug,
      title: r.title,
      sourceStatus: r.sourceStatus,
      sourcePublishedAt: r.sourcePublishedAt,
      productName: r.productName,
      target: targetRow,
      state: translationState({
        sourcePublishedVersionId: r.sourcePublishedVersionId,
        target: t ? { status: t.status, translatedFromVersionId: t.translatedFromVersionId } : null,
        activeJob: !!job,
      }),
      jobId: job?.id ?? null,
    };
  });
}

/** German-friendly slug: transliterates umlauts and ß before the ASCII slug (ä → ae, ß → ss). */
export function localizedSlug(title: string, locale: string): string {
  const text =
    locale === "de"
      ? title
          .replace(/Ä/g, "Ae")
          .replace(/Ö/g, "Oe")
          .replace(/Ü/g, "Ue")
          .replace(/ä/g, "ae")
          .replace(/ö/g, "oe")
          .replace(/ü/g, "ue")
          .replace(/ß/g, "ss")
          .replace(/&/g, " und ")
      : title;
  return slugify(text);
}

export interface SaveTranslationInput {
  sourceArticleId: string;
  sourceVersionId: string;
  locale: string;
  title: string;
  blocks: ArticleBody;
  seo: Seo | null;
  overallScore: number | null;
  factCheck: FactCheckReport | null;
  promptVersions: Record<string, string>;
  changeNote: string;
  jobId?: string | null;
}

/**
 * Creates the translated article on first run (slug from the translated title, unique per locale)
 * or appends a version to it, and records which source version it reflects. Published
 * translations keep their slug (canonical URL); the title follows the new translation.
 */
export async function saveTranslation(db: DbOrTx, input: SaveTranslationInput) {
  const source = await getArticle(db, input.sourceArticleId);
  if (!source) throw new DomainError("not_found", "Source article not found");
  let target = await findTranslation(db, source.id, input.locale);
  const isNew = !target;
  if (!target) {
    const created = await createArticle(db, {
      type: source.type,
      productId: source.productId,
      productIds: source.productIds,
      title: input.title,
      slug: localizedSlug(input.title, input.locale) || source.slug,
      locale: input.locale,
      authorId: source.authorId,
      brief: source.brief,
      categoryId: source.categoryId,
    });
    await db.update(articles).set({ translationOfId: source.id }).where(eq(articles.id, created.id));
    target = { ...created, translationOfId: source.id };
  } else if (target.title !== input.title) {
    await updateArticleMeta(db, target.id, { title: input.title });
  }
  const version = await addArticleVersion(db, target.id, {
    blocks: input.blocks,
    seo: input.seo,
    overallScore: input.overallScore,
    factCheck: input.factCheck,
    promptVersions: input.promptVersions,
    jobId: input.jobId ?? null,
    changeNote: input.changeNote,
  });
  await db.update(articles).set({ translatedFromVersionId: input.sourceVersionId }).where(eq(articles.id, target.id));
  return { articleId: target.id, versionId: version.id, version: version.version, created: isNew };
}

/** The source version a translation was made from (null for the first translation). */
export async function translatedFromVersion(db: DbOrTx, targetArticleId: string) {
  const target = await getArticle(db, targetArticleId);
  return target?.translatedFromVersionId ? getVersion(db, target.translatedFromVersionId) : null;
}

// --- Catalogue strings (category names, product taglines) ---

type LocalizedFields = (typeof categories.$inferSelect)["translations"];

function mergeLocalized(current: LocalizedFields | null | undefined, locale: string, fields: Record<string, string>) {
  const cleaned = Object.fromEntries(
    Object.entries(fields)
      .map(([k, v]) => [k, v.trim()] as const)
      .filter(([, v]) => v.length > 0),
  );
  const next: LocalizedFields = { ...(current ?? {}) };
  const existing = (next as Record<string, Record<string, string> | undefined>)[locale] ?? {};
  (next as Record<string, Record<string, string>>)[locale] = { ...existing, ...cleaned };
  return next;
}

export async function setCategoryTranslation(
  db: DbOrTx,
  categoryId: string,
  locale: string,
  fields: { name?: string; description?: string },
) {
  if (!isTranslationLocale(locale)) throw new DomainError("invalid", `Unsupported locale: ${locale}`);
  const [row] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!row) throw new DomainError("not_found", "Category not found");
  const translations = mergeLocalized(row.translations, locale, fields as Record<string, string>);
  await db.update(categories).set({ translations }).where(eq(categories.id, categoryId));
  return translations;
}

export async function setProductTranslation(
  db: DbOrTx,
  productId: string,
  locale: string,
  fields: { tagline?: string },
) {
  if (!isTranslationLocale(locale)) throw new DomainError("invalid", `Unsupported locale: ${locale}`);
  const [row] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!row) throw new DomainError("not_found", "Product not found");
  const translations = mergeLocalized(row.translations, locale, fields as Record<string, string>);
  await db.update(products).set({ translations }).where(eq(products.id, productId));
  return translations;
}

/** Categories and products with their localised fields, for the CMS editor. */
export async function catalogTranslations(db: DbOrTx) {
  const [cats, prods] = await Promise.all([
    db
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        description: categories.description,
        translations: categories.translations,
      })
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name)),
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        tagline: products.tagline,
        translations: products.translations,
      })
      .from(products)
      .where(ne(products.status, "archived"))
      .orderBy(asc(products.name)),
  ]);
  return { categories: cats, products: prods };
}

/**
 * Catalogue strings an article needs in `locale` that are still missing: its category's name and
 * description and its products' taglines.
 */
export async function missingCatalogStrings(db: DbOrTx, articleId: string, locale: string) {
  const article = await getArticle(db, articleId);
  if (!article) return [];
  const productIds = article.productIds.length ? article.productIds : article.productId ? [article.productId] : [];
  const prods = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const categoryIds = [
    ...new Set([article.categoryId, ...prods.map((p) => p.categoryId)].filter((x): x is string => !!x)),
  ];
  const cats = categoryIds.length ? await db.select().from(categories).where(inArray(categories.id, categoryIds)) : [];
  const has = (t: LocalizedFields | null, field: string) =>
    !!(t as Record<string, Record<string, string> | undefined> | null)?.[locale]?.[field];
  const out: Array<{ kind: "category" | "product"; id: string; field: string; text: string }> = [];
  for (const c of cats) {
    if (!has(c.translations, "name")) out.push({ kind: "category", id: c.id, field: "name", text: c.name });
    if (c.description && !has(c.translations, "description")) {
      out.push({ kind: "category", id: c.id, field: "description", text: c.description });
    }
  }
  for (const p of prods) {
    if (p.tagline && !has(p.translations, "tagline")) {
      out.push({ kind: "product", id: p.id, field: "tagline", text: p.tagline });
    }
  }
  return out;
}
