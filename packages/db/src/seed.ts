import { LAUNCH_CATEGORIES } from "@repo/content";
import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { authors, categories, settings } from "./schema";

/** Default settings reflecting the owner decisions in docs/srs.md §9. */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  "publishing.dailyCap": 5, // D-7
  "publishing.requireHumanReview": true, // D-3
  "publishing.autoPublishCategories": [],
  "affiliate.catchAllFallback": { enabled: true, network: null }, // D-4
  "pipeline.videoEnabled": false, // D-5: phase 2
  "pipeline.handsOnTrials": false, // D-6
  "costs.targetPerReviewUsd": { quick: 5, full: 12 }, // NFR-6
  "costs.alertMultiplier": 2,
  "editorial.aiDisclosure": "Researched with AI assistance and reviewed by our editor.",
  "editorial.styleGuide": "",
  "editorial.bannedPhrases": [
    "in today's fast-paced world",
    "game-changer",
    "game changer",
    "revolutionize",
    "unlock the power",
    "seamlessly",
    "delve",
    "elevate your",
    "look no further",
    "whether you're a",
    "in the ever-evolving",
    "harness the power",
    "cutting-edge",
    "robust solution",
    "it's worth noting",
    "at the end of the day",
  ],
  "pipeline.stepModels": {},
  "qa.thresholds": { maxReadingGrade: 11, maxSourceOverlap: 0.08, minWords: 1200 },
};

/** Idempotent: safe to run on every deploy. Never overwrites values edited in the CMS. */
export async function seed(db: Database): Promise<void> {
  await db
    .insert(categories)
    .values(LAUNCH_CATEGORIES.map((c, position) => ({ ...c, position })))
    .onConflictDoUpdate({
      target: categories.slug,
      set: { name: sql`excluded.name`, description: sql`excluded.description`, position: sql`excluded.position` },
    });

  await db
    .insert(settings)
    .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing({ target: settings.key });

  // D-8: owner is editor-in-chief. Rename and add a bio from the CMS.
  await db
    .insert(authors)
    .values({ slug: "editor-in-chief", name: "Editor-in-Chief", bio: null })
    .onConflictDoNothing({ target: authors.slug });
}
