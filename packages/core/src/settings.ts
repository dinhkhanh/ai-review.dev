import { eq, settings, sql, type DbOrTx } from "@repo/db";
import { z } from "zod";

/** Typed settings registry. Unknown keys are rejected so typos never silently persist. */
export const settingSchemas = {
  "publishing.dailyCap": z.number().int().min(0).max(500),
  "publishing.requireHumanReview": z.boolean(),
  "publishing.autoPublishCategories": z.array(z.string()),
  "affiliate.catchAllFallback": z.object({ enabled: z.boolean(), network: z.string().nullable() }),
  "pipeline.videoEnabled": z.boolean(),
  "pipeline.handsOnTrials": z.boolean(),
  "costs.targetPerReviewUsd": z.object({ quick: z.number().positive(), full: z.number().positive() }),
  "costs.alertMultiplier": z.number().min(1),
  "editorial.aiDisclosure": z.string().min(1).max(300),
  /** House style guide injected into writing prompts (FR-CON-6). */
  "editorial.styleGuide": z.string().max(20_000),
  /** Phrases the style pass removes and QA flags (FR-CON-6). */
  "editorial.bannedPhrases": z.array(z.string().min(1)).max(500),
  /** Per-step model/effort overrides (FR-CMS-7). Steps fall back to their prompt defaults. */
  "pipeline.stepModels": z.record(
    z.string(),
    z.object({ model: z.string().min(1), effort: z.enum(["low", "medium", "high", "xhigh", "max"]) }),
  ),
  /** QA thresholds (FR-QA-1). */
  "qa.thresholds": z.object({
    maxReadingGrade: z.number().min(4).max(20),
    maxSourceOverlap: z.number().min(0).max(1),
    minWords: z.number().int().min(0),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export async function getSetting<K extends SettingKey>(db: DbOrTx, key: K): Promise<SettingValue<K> | undefined> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return row ? (settingSchemas[key].parse(row.value) as SettingValue<K>) : undefined;
}

export async function setSetting<K extends SettingKey>(
  db: DbOrTx,
  key: K,
  value: SettingValue<K>,
  userId?: string,
): Promise<void> {
  const parsed = settingSchemas[key].parse(value);
  await db
    .insert(settings)
    .values({ key, value: parsed, updatedByUserId: userId ?? null })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: parsed, updatedByUserId: userId ?? null, updatedAt: sql`now()` },
    });
}
