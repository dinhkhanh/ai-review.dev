import { markStepsStale, requeueJob } from "@repo/core";
import type { DbOrTx } from "@repo/db";
import type { StepName } from "./step";

/**
 * The review pipeline in order (SRS §7). Steps after `resolve_product` run on ids. `site_check`,
 * `refresh_plan` and `refresh_rewrite` run only when refreshing a live article (FR-MNT-1); its
 * refresh skips competitors → style_pass.
 */
export const REVIEW_STEPS = [
  "resolve_product",
  "site_check",
  "crawl_official",
  "collect_third_party",
  "affiliate_discovery",
  "hands_on",
  "chunk_embed",
  "extract_facts",
  "fact_sheet",
  "refresh_plan",
  "refresh_rewrite",
  "competitors",
  "seo_brief",
  "write",
  "fact_check",
  "style_pass",
  "graphics",
  "qa_gates",
  "social",
  "publish",
] as const satisfies readonly StepName[];
export type ReviewStep = (typeof REVIEW_STEPS)[number];

/** Comparison / alternatives / best-of jobs (FR-CON-8): written from existing fact sheets. */
export const DERIVATIVE_STEPS = [
  "derivative_prepare",
  "derivative_brief",
  "derivative_write",
  "fact_check",
  "style_pass",
  "graphics",
  "qa_gates",
  "social",
  "publish",
] as const satisfies readonly StepName[];
export type DerivativeStep = (typeof DERIVATIVE_STEPS)[number];

export const DERIVATIVE_PRESETS = ["comparison", "alternatives", "best_of"] as const;

/** Translate jobs (phase 3 second locale): translate a published article, then the shared tail. */
export const TRANSLATE_STEPS = [
  "translate",
  "translate_catalog",
  "graphics",
  "qa_gates",
  "publish",
] as const satisfies readonly StepName[];
export type TranslateStep = (typeof TRANSLATE_STEPS)[number];

/** Standalone hands-on trial (FR-RES-7); its notes feed the next review or refresh. */
export const HANDS_ON_STEPS = ["hands_on"] as const satisfies readonly StepName[];

/** Steps of a job in order, by preset. */
export function stepsForPreset(preset: string): readonly string[] {
  if (preset === "translate") return TRANSLATE_STEPS;
  if (preset === "hands_on") return HANDS_ON_STEPS;
  return (DERIVATIVE_PRESETS as readonly string[]).includes(preset) ? DERIVATIVE_STEPS : REVIEW_STEPS;
}

/**
 * Marks steps stale and re-queues the job so the next run re-executes from `step` (FR-CMS-3
 * "re-run from step"). With `only`, just that step is re-run.
 */
export async function prepareRerun(
  db: DbOrTx,
  jobId: string,
  step: ReviewStep | DerivativeStep | TranslateStep,
  only = false,
  preset = "quick_review",
) {
  const steps = stepsForPreset(preset);
  const from = steps.indexOf(step);
  if (from < 0) throw new Error(`Step ${step} is not part of a ${preset} job`);
  await markStepsStale(db, jobId, only ? [step] : steps.slice(from));
  await requeueJob(db, jobId);
}
