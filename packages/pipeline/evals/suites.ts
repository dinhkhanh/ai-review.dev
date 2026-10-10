import type { Llm } from "@repo/ai";
import { DEFAULT_RUBRIC, extractClaims } from "@repo/content";
import {
  getCurrentVersion,
  getSetting,
  latestFactSheet,
  listSources,
  sourceRefs,
  type EvalCaseResult,
  type EvalSuite,
} from "@repo/core";
import { categories, eq, type Database } from "@repo/db";
import { gatherEvidence, toChecked, verifyClaims } from "../src/fact-check-core";
import type { PromptKey } from "../src/prompts";
import { executeStep, type StepServices } from "../src/step";
import { extractFactsStep } from "../src/steps/extract-facts";
import { factSheetStep } from "../src/steps/fact-sheet";
import { writeStep } from "../src/steps/write";
import type { GoldenCase } from "./golden";
import { seedSnapshot } from "./harness";
import { judgeArticle } from "./judge";
import {
  gradeArticle,
  scoreFactCheck,
  scoreFactSheet,
  seedErrors,
  seededClaimIds,
  shareOf,
  type Check,
} from "./scoring";
import type { Snapshot } from "./snapshot-schema";

/** Prompts each suite exercises (recorded on the eval run for comparisons). */
export const SUITE_PROMPTS: Record<EvalSuite, PromptKey[]> = {
  fact_sheet: ["extract_facts", "fact_sheet"],
  write: ["write"],
  fact_check: ["fact_check"],
};

export interface SuiteDeps {
  db: Database;
  services: StepServices;
  /** Client for the LLM judge and the fact-check suite (costs metered like the steps'). */
  llm: Llm;
  /** Seeded errors per fact_check case. */
  seededErrors?: number;
  /** Unmodified claims checked alongside the seeded ones (false-positive control). */
  controlClaims?: number;
  /** Skip the LLM judge in the write suite (deterministic grading only). */
  noJudge?: boolean;
}

const result = (c: GoldenCase, checks: Check[], extra: Partial<EvalCaseResult> = {}): EvalCaseResult => {
  const score = Math.round(shareOf(checks) * 1000) / 1000;
  return { case: c.slug, status: checks.every((x) => x.passed) ? "passed" : "failed", score, checks, ...extra };
};

/** fact_sheet: extract_facts + fact_sheet on the frozen sources, graded against the golden fields. */
export async function runFactSheetCase(deps: SuiteDeps, c: GoldenCase, snap: Snapshot): Promise<EvalCaseResult> {
  const seeded = await seedSnapshot(deps.db, snap);
  await executeStep(deps.services, extractFactsStep, { productId: seeded.productId }, { jobId: seeded.jobId });
  await executeStep(deps.services, factSheetStep, { productId: seeded.productId }, { jobId: seeded.jobId });
  const sheet = await latestFactSheet(deps.db, seeded.productId);
  const graded = scoreFactSheet(c.expect, sheet?.data ?? null);
  return result(c, graded.checks, { metrics: graded.metrics });
}

/** write: the write step on the snapshot's fact sheet and brief, graded by code and an LLM judge. */
export async function runWriteCase(deps: SuiteDeps, c: GoldenCase, snap: Snapshot): Promise<EvalCaseResult> {
  const seeded = await seedSnapshot(deps.db, snap, { factSheet: true, brief: true });
  const out = await executeStep(deps.services, writeStep, { productId: seeded.productId }, { jobId: seeded.jobId });
  const version = await getCurrentVersion(deps.db, out.articleId);
  if (!version) throw new Error("write produced no version");
  const [category] = snap.product.categorySlug
    ? await deps.db.select().from(categories).where(eq(categories.slug, snap.product.categorySlug)).limit(1)
    : [];
  const rubric = category?.rubric?.length ? category.rubric : DEFAULT_RUBRIC;
  const [banned, thresholds] = await Promise.all([
    getSetting(deps.db, "editorial.bannedPhrases"),
    getSetting(deps.db, "qa.thresholds"),
  ]);
  const graded = gradeArticle(version.blocks, {
    overallScore: version.overallScore,
    expect: c.expect,
    sourceIds: seeded.sourceIds,
    rubricKeys: rubric.map((d) => d.key),
    bannedPhrases: banned ?? [],
    minWords: thresholds?.minWords ?? 1200,
  });
  const checks = [...graded.checks];
  const metrics: Record<string, number | string | null> = { ...graded.metrics };
  let judge: unknown = null;
  if (!deps.noJudge) {
    const j = await judgeArticle(deps.llm, {
      productName: snap.product.name,
      factSheet: snap.factSheet,
      blocks: version.blocks,
    });
    checks.push(...j.checks);
    metrics.judgeMean = j.mean;
    judge = j.scores;
  }
  return result(c, checks, { metrics, judge });
}

/**
 * fact_check: seeds wrong figures into cited sentences of the snapshot article, then runs claim
 * verification (the fact_check prompt with real evidence retrieval) on the seeded claims plus a
 * control sample. The repair pass (fact_fix) is out of scope: this measures detection.
 */
export async function runFactCheckCase(deps: SuiteDeps, c: GoldenCase, snap: Snapshot): Promise<EvalCaseResult> {
  if (!snap.article)
    return { case: c.slug, status: "skipped", score: null, checks: [], note: "snapshot has no article" };
  const { blocks, seeded } = seedErrors(snap.article.blocks, deps.seededErrors ?? 6);
  if (seeded.length === 0) {
    return { case: c.slug, status: "skipped", score: null, checks: [], note: "no cited figures to mutate" };
  }
  const seededCase = await seedSnapshot(deps.db, { ...snap, article: { ...snap.article, blocks } }, { article: true });
  const claims = extractClaims(blocks);
  const seededIds = seededClaimIds(claims, seeded);
  const controls = claims
    .filter((cl) => !seededIds.has(cl.id) && cl.sourceIds.length > 0)
    .filter((_, i, all) => i % Math.max(1, Math.floor(all.length / (deps.controlClaims ?? 14))) === 0)
    .slice(0, deps.controlClaims ?? 14);
  const subset = [...claims.filter((cl) => seededIds.has(cl.id)), ...controls];
  const refs = sourceRefs(await listSources(deps.db, seededCase.productId));
  const llm = deps.services.makeLlm(() => {});
  const factDeps = { db: deps.db, llm, embedder: null };
  const evidence = await gatherEvidence(factDeps, seededCase.productId, subset);
  const verdicts = await verifyClaims(factDeps, subset, evidence, refs);
  const checked = toChecked(subset, verdicts, refs);
  const graded = scoreFactCheck(checked, seededIds);
  return result(c, graded.checks, {
    metrics: graded.metrics,
    seeded: seeded.map((s) => ({ blockId: s.blockId, from: s.from, to: s.to })),
  });
}

export const SUITES: Record<EvalSuite, (deps: SuiteDeps, c: GoldenCase, snap: Snapshot) => Promise<EvalCaseResult>> = {
  fact_sheet: runFactSheetCase,
  write: runWriteCase,
  fact_check: runFactCheckCase,
};

/** What a case needs from its snapshot for each suite. */
export function missingForSuite(suite: EvalSuite, snap: Snapshot): string | null {
  if (suite === "fact_sheet") return snap.sources.length ? null : "snapshot has no sources";
  if (suite === "write")
    return !snap.factSheet ? "snapshot has no fact sheet" : !snap.brief ? "snapshot has no SEO brief" : null;
  return snap.article ? null : "snapshot has no article";
}
