import { markStepsStale, requeueJob } from "@repo/core";
import type { DbOrTx } from "@repo/db";
import type { StepName } from "./step";

/** The review pipeline in order (SRS §7). Steps after `resolve_product` run on ids. */
export const REVIEW_STEPS = [
  "resolve_product",
  "crawl_official",
  "collect_third_party",
  "affiliate_discovery",
  "chunk_embed",
  "extract_facts",
  "fact_sheet",
  "competitors",
  "seo_brief",
  "write",
  "fact_check",
  "style_pass",
  "graphics",
  "qa_gates",
] as const satisfies readonly StepName[];
export type ReviewStep = (typeof REVIEW_STEPS)[number];

/**
 * Marks steps stale and re-queues the job so the next run re-executes from `step` (FR-CMS-3
 * "re-run from step"). With `only`, just that step is re-run.
 */
export async function prepareRerun(db: DbOrTx, jobId: string, step: ReviewStep, only = false) {
  const from = REVIEW_STEPS.indexOf(step);
  await markStepsStale(db, jobId, only ? [step] : REVIEW_STEPS.slice(from));
  await requeueJob(db, jobId);
}
