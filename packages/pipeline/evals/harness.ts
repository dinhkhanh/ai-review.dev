import { createLlm, type CostHandler, type FirecrawlAdapter, type Llm } from "@repo/ai";
import { slugify } from "@repo/content";
import {
  addArticleVersion,
  createArticle,
  createReviewJob,
  ensureGoSlug,
  finishStep,
  getSetting,
  registrableDomain,
  saveFactSheet,
  setSetting,
  startStep,
  type SettingKey,
} from "@repo/core";
import {
  categories,
  competitors,
  createDb,
  eq,
  productSources,
  products,
  promptTemplates,
  researchChunks,
  sql,
  type Database,
} from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { resolvePrompt, type PromptKey } from "../src/prompts";
import type { StepServices } from "../src/step";
import type { Snapshot } from "./snapshot-schema";

/**
 * Evals run the real steps (same prompts, schemas, retrieval and fact-check code) against an
 * isolated database seeded from a snapshot. That keeps the pipeline code the single source of
 * truth: no prompt is duplicated here, and a CMS prompt override is tested exactly as production
 * would resolve it. The main database is only read (settings, prompt overrides) and receives the
 * eval_runs row.
 */
export type PromptSource = "repo" | "db";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** `<main db>_eval` next to DATABASE_URL, unless EVAL_DATABASE_URL points elsewhere. */
export function evalBaseUrl(mainUrl: string, explicit?: string | null): string {
  if (explicit) return explicit;
  const url = new URL(mainUrl);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error("DATABASE_URL is not local; set EVAL_DATABASE_URL to a scratch database for evals");
  }
  url.pathname = `/${url.pathname.slice(1)}_eval`;
  return url.toString();
}

/** Creates (if needed), migrates and opens the isolated eval database. */
export async function openEvalDb(mainDb: Database, mainUrl: string) {
  // The eval CLI runs outside Turborepo tasks, so this variable is deliberately not in turbo.json.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const explicit = process.env.EVAL_DATABASE_URL;
  const base = evalBaseUrl(mainUrl, explicit);
  const name = new URL(base).pathname.slice(1);
  if (!explicit) {
    const rows = await mainDb.execute<{ n: number }>(sql`select 1 as n from pg_database where datname = ${name}`);
    if (rows.length === 0) await mainDb.execute(sql.raw(`create database "${name.replace(/"/g, "")}"`));
  }
  // setupTestDb derives a per-package database under `base` and runs migrations there.
  process.env.TEST_DATABASE_URL = base;
  return setupTestDb();
}

/** Settings copied from the main database in both modes, so only the prompts differ between runs. */
const SHARED_SETTINGS: SettingKey[] = [
  "editorial.styleGuide",
  "editorial.bannedPhrases",
  "editorial.aiDisclosure",
  "qa.thresholds",
];

/** Makes the eval database resolve prompts like `source`: repo defaults, or the main DB's active overrides. */
export async function applyPromptSource(evalDb: Database, mainDb: Database | null, source: PromptSource) {
  if (!mainDb) return;
  for (const key of SHARED_SETTINGS) {
    const value = await getSetting(mainDb, key);
    if (value !== undefined) await setSetting(evalDb, key, value as never);
  }
  if (source === "repo") return;
  const stepModels = await getSetting(mainDb, "pipeline.stepModels");
  if (stepModels) await setSetting(evalDb, "pipeline.stepModels", stepModels);
  const overrides = await mainDb.select().from(promptTemplates).where(eq(promptTemplates.active, true));
  for (const o of overrides) {
    await evalDb
      .insert(promptTemplates)
      .values({ key: o.key, version: o.version, body: o.body, active: true, notes: o.notes })
      .onConflictDoNothing();
  }
}

export async function promptVersions(db: Database, keys: PromptKey[], source: PromptSource) {
  const out: Record<string, string> = { source };
  for (const key of keys) {
    const p = await resolvePrompt(db, key);
    out[key] = `${p.version} ${p.model}/${p.effort}`;
  }
  return out;
}

export interface SeededCase {
  productId: string;
  jobId: string;
  articleId: string | null;
  sourceIds: Set<string>;
}

/**
 * Loads a snapshot into an empty eval database: product, sources (original ids, so citations
 * resolve), chunks without embeddings (retrieval uses full-text search, deterministic and free),
 * competitors, go-slug, a job, and optionally the fact sheet, the brief (as the job's seo_brief
 * output) and the article.
 */
export async function seedSnapshot(
  db: Database,
  snap: Snapshot,
  opts: { factSheet?: boolean; brief?: boolean; article?: boolean } = {},
): Promise<SeededCase> {
  const name = snap.product.slug;
  if (opts.factSheet && !snap.factSheet) throw new Error(`Snapshot ${name} has no fact sheet`);
  if (opts.brief && !snap.brief) throw new Error(`Snapshot ${name} has no SEO brief`);
  if (opts.article && !snap.article) throw new Error(`Snapshot ${name} has no article`);
  await seed(db);
  const [category] = snap.product.categorySlug
    ? await db.select().from(categories).where(eq(categories.slug, snap.product.categorySlug)).limit(1)
    : [];
  const [product] = await db
    .insert(products)
    .values({
      name: snap.product.name,
      slug: snap.product.slug,
      websiteUrl: snap.product.websiteUrl,
      domain: snap.product.domain,
      tagline: snap.product.tagline,
      categoryId: category?.id ?? null,
      profile: snap.product.profile as never,
      lastResearchedAt: new Date(snap.exportedAt),
    })
    .returning();
  const productId = product!.id;
  if (snap.sources.length) {
    await db.insert(productSources).values(
      snap.sources.map((s) => ({
        id: s.id,
        productId,
        url: s.url,
        kind: s.kind,
        title: s.title,
        contentMd: s.contentMd,
        fetchedAt: new Date(s.fetchedAt),
        createdAt: new Date(s.createdAt),
        httpStatus: 200,
      })),
    );
  }
  for (let i = 0; i < snap.chunks.length; i += 200) {
    await db.insert(researchChunks).values(snap.chunks.slice(i, i + 200).map((c) => ({ ...c, productId })));
  }
  for (const [position, c] of snap.competitors.entries()) {
    const domain = registrableDomain(c.websiteUrl);
    const [row] = await db
      .insert(products)
      .values({ name: c.name, slug: slugify(c.name) || slugify(domain), websiteUrl: c.websiteUrl, domain })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await db
        .insert(competitors)
        .values({ productId, competitorProductId: row.id, relation: c.relation, note: c.note, position });
    }
  }
  await ensureGoSlug(db, product!);
  if (opts.factSheet) await saveFactSheet(db, productId, snap.factSheet!);
  const job = await createReviewJob(db, {
    preset: "quick_review",
    productId,
    input: { url: snap.product.websiteUrl, name: snap.product.name, productId, eval: true },
  });
  if (opts.brief) {
    const { step } = await startStep(db, job.id, "seo_brief", { productId });
    await finishStep(db, step.id, { status: "succeeded", output: { brief: snap.brief } });
  }
  let articleId: string | null = null;
  if (opts.article && snap.article) {
    const article = await createArticle(db, {
      type: "review",
      productId,
      title: snap.article.title,
      slug: snap.article.slug,
      brief: snap.brief,
    });
    await addArticleVersion(db, article.id, {
      blocks: snap.article.blocks,
      overallScore: snap.article.overallScore,
      changeNote: "Eval snapshot",
    });
    articleId = article.id;
  }
  return { productId, jobId: job.id, articleId, sourceIds: new Set(snap.sources.map((s) => s.id)) };
}

/** Running total of model spend for one eval run (also written to the eval DB's ledger). */
export function costMeter() {
  let total = 0;
  const wrap =
    (inner?: CostHandler): CostHandler =>
    async (event) => {
      total += event.costUsd;
      await inner?.(event);
    };
  return { wrap, total: () => total };
}

const noFirecrawl = new Proxy({} as FirecrawlAdapter, {
  get() {
    throw new Error("Evals run on snapshots; Firecrawl is not available");
  },
});

/** Step services for evals: real Claude client (or an injected fake), no crawling, no embeddings. */
export function evalServices(
  db: Database,
  meter: ReturnType<typeof costMeter>,
  makeLlm: (onCost: CostHandler) => Llm = (onCost) => createLlm({ onCost }),
): StepServices {
  return {
    db,
    makeLlm: (onCost) => makeLlm(meter.wrap(onCost)),
    makeFirecrawl: () => noFirecrawl,
    makeEmbedder: () => null,
  };
}

/** Opens the main database (DATABASE_URL) for reading settings and writing eval_runs. */
export function openMainDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return { url, ...createDb(url, { max: 2 }) };
}
