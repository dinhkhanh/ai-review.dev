import { articleBodySchema, factSheetSchema, seoBriefSchema } from "@repo/content";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/** Source pages are clipped to what the prompts read (extract_facts clips at 24k characters). */
export const SNAPSHOT_SOURCE_CHARS = 24_000;

/**
 * Frozen research for one product, exported from a researched database so evals re-run prompts
 * without re-crawling (and without crawl drift). Source ids are kept, so the fact sheet's and the
 * article's citations stay valid when the snapshot is loaded into the eval database.
 */
export const snapshotSchema = z.object({
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  product: z.object({
    name: z.string(),
    slug: z.string(),
    websiteUrl: z.url(),
    domain: z.string(),
    tagline: z.string().nullable(),
    categorySlug: z.string().nullable(),
    profile: z.record(z.string(), z.unknown()).nullable(),
  }),
  sources: z.array(
    z.object({
      id: z.uuid(),
      url: z.string(),
      kind: z.enum(["official", "aggregator", "community", "video", "news", "other"]),
      title: z.string().nullable(),
      fetchedAt: z.iso.datetime(),
      createdAt: z.iso.datetime(),
      contentMd: z.string().nullable(),
    }),
  ),
  chunks: z.array(
    z.object({ sourceId: z.uuid(), ord: z.number().int(), text: z.string(), tokenCount: z.number().int().nullable() }),
  ),
  factSheet: factSheetSchema.nullable(),
  brief: seoBriefSchema.nullable(),
  article: z
    .object({
      title: z.string(),
      slug: z.string(),
      blocks: articleBodySchema,
      overallScore: z.number().nullable(),
    })
    .nullable(),
  competitors: z.array(
    z.object({
      name: z.string(),
      websiteUrl: z.string(),
      relation: z.enum(["alternative", "direct"]),
      note: z.string().nullable(),
    }),
  ),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const snapshotPath = (name: string) => new URL(`./snapshots/${name}.json`, import.meta.url);

/** Loads a snapshot, or null when it has not been exported on this machine. */
export function loadSnapshot(name: string): Snapshot | null {
  const path = snapshotPath(name);
  if (!existsSync(path)) return null;
  return snapshotSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
