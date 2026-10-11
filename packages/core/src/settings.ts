import { eq, settings, sql, type DbOrTx } from "@repo/db";
import { z } from "zod";

/** Typed settings registry. Unknown keys are rejected so typos never silently persist. */
export const settingSchemas = {
  "publishing.dailyCap": z.number().int().min(0).max(500),
  "publishing.requireHumanReview": z.boolean(),
  "publishing.autoPublishCategories": z.array(z.string()),
  /** Auto-publish rule (FR-QA-4): hard gates pass and this share of soft checks pass (0–1). */
  "publishing.autoPublish": z.object({ minSoftScore: z.number().min(0).max(1) }),
  /** FR-AFF-5: wrap the vendor fallback in a catch-all network when no direct program exists. */
  "affiliate.catchAllFallback": z.object({
    enabled: z.boolean(),
    network: z.enum(["skimlinks", "sovrn"]).nullable(),
    /** Skimlinks publisher id (e.g. "123456X789") or Sovrn/VigLink API key; public by design. */
    publisherId: z.string().max(100).nullable().optional(),
  }),
  "pipeline.videoEnabled": z.boolean(),
  "pipeline.handsOnTrials": z.boolean(),
  "costs.targetPerReviewUsd": z.object({ quick: z.number().positive(), full: z.number().positive() }),
  "costs.alertMultiplier": z.number().min(1),
  /** Default per-job cost ceiling in USD (FR-INT-6); jobs pause for approval above it. Null = none. */
  "costs.defaultCeilingUsd": z.number().positive().max(500).nullable(),
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
  /** Refresh scheduler (FR-MNT-1). Top-traffic pages use the shorter interval. */
  "refresh.policy": z.object({
    enabled: z.boolean(),
    defaultIntervalDays: z.number().int().min(1).max(365),
    topTrafficIntervalDays: z.number().int().min(1).max(365),
    topTrafficMinPageviews30d: z.number().int().min(0),
    maxJobsPerRun: z.number().int().min(0).max(100),
  }),
  /** Daily affiliate link health check (FR-AFF-10). */
  "linkHealth.policy": z.object({
    enabled: z.boolean(),
    /** Consecutive failed checks before a link is paused as broken. */
    failuresBeforePause: z.number().int().min(1).max(10),
  }),
  /** Who receives notification emails (FR-CMS-8). Webhook targets come from env. */
  "notifications.recipients": z.array(z.email()).max(20),
  /** Per-event channel switches; events missing here use NOTIFICATION_DEFAULTS in @repo/core. */
  "notifications.events": z.record(z.string(), z.object({ email: z.boolean(), webhook: z.boolean() })),
  /** Product sourcing cron (FR-INT-7). */
  "sourcing.policy": z.object({
    enabled: z.boolean(),
    sources: z.array(z.enum(["producthunt", "hackernews", "networks"])),
    maxPerRun: z.number().int().min(0).max(200),
    minScore: z.number().min(0),
  }),
  /** Video pipeline (FR-VID-1..5). */
  "video.settings": z.object({
    /** TTS voice id (provider-specific). Null uses the adapter default. */
    voiceId: z.string().max(100).nullable(),
    kinds: z.array(z.enum(["short", "long"])),
    youtubePrivacy: z.enum(["private", "unlisted", "public"]),
    /** Generate videos automatically when an article is first published. */
    autoGenerate: z.boolean(),
  }),
  /** Weekly newsletter digest (FR-WEB-9). `autoSend` false leaves each issue as a draft to approve. */
  "newsletter.digest": z.object({
    enabled: z.boolean(),
    /** 0 = Sunday … 6 = Saturday, in UTC. */
    weekday: z.number().int().min(0).max(6),
    hourUtc: z.number().int().min(0).max(23),
    maxItems: z.number().int().min(1).max(30),
    autoSend: z.boolean(),
  }),
  /** Search Console import and content-decay detection (FR-MNT-3). */
  "searchConsole.policy": z.object({
    enabled: z.boolean(),
    /** Compare the last `windowDays` with the `windowDays` before them. */
    windowDays: z.number().int().min(7).max(90),
    /** Flag a page when clicks fall by at least this share (0–1)… */
    minClickDrop: z.number().min(0).max(1),
    /** …and it had at least this many clicks in the earlier window. */
    minBaselineClicks: z.number().int().min(0),
    /** Pull flagged products' next refresh forward (FR-MNT-1 integration). */
    scheduleRefresh: z.boolean(),
  }),
  /** Second locale (phase 3). Locales listed here are public; `autoTranslate` queues a translation on publish. */
  "i18n.policy": z.object({
    enabledLocales: z.array(z.enum(["en", "de"])).min(1),
    autoTranslate: z.array(z.enum(["de"])),
  }),
  /** A/B offers (FR-AFF-13): a variant needs this many clicks before the report calls a winner. */
  "affiliate.experiments": z.object({
    minClicksPerVariant: z.number().int().min(1),
    /** Two-sided confidence for the conversion-rate test (e.g. 0.95). */
    confidence: z.number().min(0.5).max(0.999),
  }),
  /** Hands-on browser agent limits (FR-RES-7); the on/off switch is `pipeline.handsOnTrials`. */
  "handsOn.policy": z.object({
    maxSteps: z.number().int().min(5).max(200),
    maxCostUsd: z.number().positive().max(20),
    maxMinutes: z.number().int().min(1).max(60),
  }),
  /** Mobile push (FR-API-4): price-change alerts on/off and a per-device daily cap. */
  "mobile.push": z.object({ priceAlerts: z.boolean(), maxPerDevicePerDay: z.number().int().min(1).max(20) }),
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
  // A top-level null (e.g. "no default ceiling") must be stored as JSON null; drizzle would send SQL NULL.
  const stored = parsed === null ? sql`'null'::jsonb` : parsed;
  await db
    .insert(settings)
    .values({ key, value: stored, updatedByUserId: userId ?? null })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: stored, updatedByUserId: userId ?? null, updatedAt: sql`now()` },
    });
}
