import {
  findArticleForProduct,
  getCurrentVersion,
  getProductBySlug,
  latestFactSheet,
  listCompetitors,
} from "@repo/core";
import { asc, categories, createDb, eq, productSources, researchChunks, type Database } from "@repo/db";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SNAPSHOT_SOURCE_CHARS, snapshotPath, snapshotSchema, type Snapshot } from "./snapshot-schema";

/**
 * Exports a researched product into evals/snapshots/<slug>.json (read-only on the database).
 *   pnpm --filter @repo/pipeline eval:snapshot -- plausible-analytics [more-slugs...]
 * Snapshots hold third-party page text, so they stay out of git (see evals/README.md).
 */
export async function exportSnapshot(db: Database, slug: string): Promise<Snapshot> {
  const product = await getProductBySlug(db, slug);
  if (!product) throw new Error(`No product with slug ${slug}`);
  const [category] = product.categoryId
    ? await db.select().from(categories).where(eq(categories.id, product.categoryId)).limit(1)
    : [];
  const sources = await db
    .select()
    .from(productSources)
    .where(eq(productSources.productId, product.id))
    .orderBy(asc(productSources.createdAt));
  if (sources.length === 0) throw new Error(`${slug} has no research sources; run the pipeline first`);
  const chunks = await db
    .select({
      sourceId: researchChunks.sourceId,
      ord: researchChunks.ord,
      text: researchChunks.text,
      tokenCount: researchChunks.tokenCount,
    })
    .from(researchChunks)
    .where(eq(researchChunks.productId, product.id))
    .orderBy(asc(researchChunks.sourceId), asc(researchChunks.ord));
  const [sheet, article, comps] = await Promise.all([
    latestFactSheet(db, product.id),
    findArticleForProduct(db, product.id),
    listCompetitors(db, product.id),
  ]);
  const version = article ? await getCurrentVersion(db, article.id) : null;
  return snapshotSchema.parse({
    version: 1,
    exportedAt: new Date().toISOString(),
    product: {
      name: product.name,
      slug: product.slug,
      websiteUrl: product.websiteUrl,
      domain: product.domain,
      tagline: product.tagline,
      categorySlug: category?.slug ?? null,
      profile: (product.profile as Record<string, unknown> | null) ?? null,
    },
    sources: sources.map((s) => ({
      id: s.id,
      url: s.url,
      kind: s.kind,
      title: s.title,
      fetchedAt: s.fetchedAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      contentMd: s.contentMd ? s.contentMd.slice(0, SNAPSHOT_SOURCE_CHARS) : null,
    })),
    chunks,
    factSheet: sheet?.data ?? null,
    brief: article?.brief ?? null,
    article:
      article && version
        ? { title: article.title, slug: article.slug, blocks: version.blocks, overallScore: version.overallScore }
        : null,
    competitors: comps.map((c) => ({ name: c.name, websiteUrl: c.websiteUrl, relation: c.relation, note: c.note })),
  });
}

async function main() {
  const slugs = process.argv.slice(2).filter((a) => a !== "--");
  if (slugs.length === 0) throw new Error("Usage: eval:snapshot -- <product-slug> [...]");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, close } = createDb(url, { max: 1 });
  try {
    mkdirSync(fileURLToPath(new URL("./snapshots/", import.meta.url)), { recursive: true });
    for (const slug of slugs) {
      const snap = await exportSnapshot(db, slug);
      const path = snapshotPath(slug);
      writeFileSync(path, `${JSON.stringify(snap, null, 1)}\n`);
      console.log(
        `${slug}: ${snap.sources.length} sources, ${snap.chunks.length} chunks, fact sheet ${snap.factSheet ? "yes" : "no"}, article ${snap.article ? "yes" : "no"} → ${fileURLToPath(path)}`,
      );
    }
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
