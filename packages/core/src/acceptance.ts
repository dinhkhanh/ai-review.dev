import { type ArticleBody, type FactSheet } from "@repo/content";
import {
  and,
  articles,
  articleVersions,
  costLedger,
  desc,
  eq,
  factSheets,
  goSlugs,
  inArray,
  jobSteps,
  mediaAssets,
  or,
  productSources,
  products,
  reviewJobs,
  sql,
  type DbOrTx,
} from "@repo/db";
import { pricingCitationCoverage } from "./fact-sheets";
import { getSetting } from "./settings";

/**
 * SRS §8 acceptance evaluator (Phase 4, launch readiness). Every check reads stored data only:
 * job steps, sources, fact sheets, media, article versions, the QA scorecard and the cost ledger.
 * Criteria 2–4 are partly live behaviour (page served, redirect, clicks, Lighthouse); those parts
 * are covered by `pnpm launch-check` and the e2e suite and are reported here as `n/a`.
 */

export type CheckStatus = "pass" | "fail" | "warn" | "n/a";

export type CheckItem = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  evidence?: Record<string, unknown>;
};

export type AcceptanceCriterion = CheckItem & {
  /** SRS §8 criterion number (1–6). */
  criterion: number;
};

export type StatusCounts = Record<CheckStatus, number>;

export type JobAcceptance = {
  jobId: string;
  preset: string;
  jobStatus: string;
  createdAt: Date;
  productId: string | null;
  productName: string | null;
  articleId: string | null;
  articleTitle: string | null;
  articleStatus: string | null;
  criteria: AcceptanceCriterion[];
  summary: StatusCounts;
};

/** Thresholds from SRS §8. */
export const ACCEPTANCE_TARGETS = {
  inReviewMinutes: 30,
  pricingCitationShare: 0.9,
  minSources: 8,
  minThirdPartySources: 2,
  quickReviewMaxUsd: 5,
  rubricDimensions: { min: 5, max: 7 },
} as const;

/** Presets that produce a single-product review; criterion 1 only applies to these. */
export const ACCEPTANCE_PRESETS = ["full_review", "quick_review", "refresh"] as const;

const REQUIRED_SCREENSHOTS = ["screenshot:home:desktop", "screenshot:pricing:desktop"];
const OPTIONAL_SCREENSHOTS = ["screenshot:home:mobile", "screenshot:pricing:mobile"];
const LIVE_CHECKS = "pnpm launch-check --site <url> and the e2e suite (pnpm e2e)";

export function countStatuses(items: Array<{ status: CheckStatus }>): StatusCounts {
  const counts: StatusCounts = { pass: 0, fail: 0, warn: 0, "n/a": 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/**
 * Pricing fields of a fact sheet, as counted by `pricingCitationCoverage`: `pricing.tiers`,
 * `pricing.freePlan`, `pricing.freeTrialDays` and `pricing.moneyBackDays`, each only when present.
 */
export function pricingFieldCitations(sheet: FactSheet): Array<{ field: string; cited: boolean }> {
  const p = sheet.pricing;
  if (!p) return [];
  const fields = {
    tiers: p.tiers,
    freePlan: p.freePlan,
    freeTrialDays: p.freeTrialDays,
    moneyBackDays: p.moneyBackDays,
  };
  return Object.entries(fields)
    .filter(([, f]) => !!f)
    .map(([field, f]) => ({ field: `pricing.${field}`, cited: f!.citations.length > 0 }));
}

/** Go-link slugs referenced by CTA blocks and inline `golink` marks. */
export function goSlugsInBlocks(blocks: ArticleBody): string[] {
  const slugs = new Set<string>();
  const inline = (children: Array<{ marks: Array<{ type: string; slug?: string }> }>) => {
    for (const seg of children) for (const m of seg.marks) if (m.type === "golink" && m.slug) slugs.add(m.slug);
  };
  for (const b of blocks) {
    if (b.type === "cta") slugs.add(b.goSlug);
    else if (b.type === "paragraph" || b.type === "callout") inline(b.children);
    else if (b.type === "list") b.items.forEach(inline);
    else if (b.type === "faq") b.items.forEach((i) => inline(i.answer));
  }
  return [...slugs];
}

const minutesBetween = (a: Date, b: Date) => Math.round(((b.getTime() - a.getTime()) / 60_000) * 10) / 10;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** Evaluates SRS §8 for one job. Returns null when the job does not exist. */
export async function evaluateJobAcceptance(db: DbOrTx, jobId: string): Promise<JobAcceptance | null> {
  const [job] = await db.select().from(reviewJobs).where(eq(reviewJobs.id, jobId)).limit(1);
  if (!job) return null;

  const [product] = job.productId
    ? await db.select().from(products).where(eq(products.id, job.productId)).limit(1)
    : [];
  const articleId =
    job.articleId ??
    (product
      ? ((
          await db
            .select({ id: articles.id })
            .from(articles)
            .where(and(eq(articles.productId, product.id), eq(articles.type, "review"), eq(articles.locale, "en")))
            .limit(1)
        )[0]?.id ?? null)
      : null);
  const [article] = articleId ? await db.select().from(articles).where(eq(articles.id, articleId)).limit(1) : [];

  // The version this job wrote (the one that went to review); else the article's current version.
  const [jobVersion] = article
    ? await db
        .select()
        .from(articleVersions)
        .where(and(eq(articleVersions.articleId, article.id), eq(articleVersions.createdByJobId, job.id)))
        .orderBy(desc(articleVersions.version))
        .limit(1)
    : [];
  const [currentVersion] =
    !jobVersion && article?.currentVersionId
      ? await db.select().from(articleVersions).where(eq(articleVersions.id, article.currentVersionId)).limit(1)
      : [];
  const version = jobVersion ?? currentVersion ?? null;

  const isReviewJob = (ACCEPTANCE_PRESETS as readonly string[]).includes(job.preset) && !!product;
  const criteria: AcceptanceCriterion[] = [];
  const add = (criterion: number, item: CheckItem) => criteria.push({ criterion, ...item });

  // ---- §8 #1: research, evidence, scoring and QA, within 30 minutes ----
  if (!isReviewJob) {
    add(1, {
      id: "1.review",
      label: "Review output (sources, fact sheet, evidence, QA)",
      status: "n/a",
      detail: `Applies to review jobs (${ACCEPTANCE_PRESETS.join(", ")}) with a product; this is ${job.preset}.`,
    });
  } else {
    const steps = await db
      .select()
      .from(jobSteps)
      .where(and(eq(jobSteps.jobId, job.id), eq(jobSteps.name, "qa_gates")))
      .orderBy(jobSteps.attempt);
    // qa_gates moves the article to in_review; its first finished attempt is when that happened.
    const reached = steps
      .filter((s) => (s.status === "succeeded" || s.status === "stale") && s.finishedAt)
      .map((s) => s.finishedAt!)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (reached) {
      const minutes = minutesBetween(job.createdAt, reached);
      const active = job.startedAt ? minutesBetween(job.startedAt, reached) : null;
      add(1, {
        id: "1.timing",
        label: `In review within ${ACCEPTANCE_TARGETS.inReviewMinutes} min of submission`,
        status: minutes <= ACCEPTANCE_TARGETS.inReviewMinutes ? "pass" : "fail",
        detail: `${minutes} min from job creation to the first finished qa_gates step (which moves the article to in_review)${active !== null ? `; ${active} min after the worker started it` : ""}. Time spent paused for cost approval counts.`,
        evidence: { createdAt: job.createdAt, startedAt: job.startedAt, inReviewAt: reached, minutes },
      });
    } else {
      const running = job.status === "queued" || job.status === "running" || job.status === "awaiting_approval";
      add(1, {
        id: "1.timing",
        label: `In review within ${ACCEPTANCE_TARGETS.inReviewMinutes} min of submission`,
        status: running ? "warn" : "fail",
        detail: running
          ? `Job is ${job.status}; qa_gates has not finished yet.`
          : "The qa_gates step never finished, so the article did not reach in_review from this job.",
      });
    }

    const [sheetByJob] = await db
      .select()
      .from(factSheets)
      .where(and(eq(factSheets.productId, product.id), eq(factSheets.createdByJobId, job.id)))
      .orderBy(desc(factSheets.version))
      .limit(1);
    const [latestSheet] = sheetByJob
      ? [sheetByJob]
      : await db
          .select()
          .from(factSheets)
          .where(eq(factSheets.productId, product.id))
          .orderBy(desc(factSheets.version))
          .limit(1);
    if (!latestSheet) {
      add(1, {
        id: "1.pricing_citations",
        label: "≥ 90 % of pricing fields cited",
        status: "fail",
        detail: "No fact sheet for this product.",
      });
    } else {
      const fields = pricingFieldCitations(latestSheet.data);
      const share = pricingCitationCoverage(latestSheet.data);
      const uncited = fields.filter((f) => !f.cited).map((f) => f.field);
      add(1, {
        id: "1.pricing_citations",
        label: "≥ 90 % of pricing fields cited",
        status: fields.length > 0 && share >= ACCEPTANCE_TARGETS.pricingCitationShare ? "pass" : "fail",
        detail:
          fields.length === 0
            ? `Fact sheet v${latestSheet.version} has no pricing fields.`
            : `${Math.round(share * 100)} % of ${fields.length} pricing fields cited in fact sheet v${latestSheet.version}${uncited.length ? ` (uncited: ${uncited.join(", ")})` : ""}. Pricing fields = pricing.tiers, freePlan, freeTrialDays, moneyBackDays when present.`,
        evidence: { factSheetId: latestSheet.id, version: latestSheet.version, fields, byThisJob: !!sheetByJob },
      });
    }

    const sources = await db
      .select({ kind: productSources.kind, createdByJobId: productSources.createdByJobId })
      .from(productSources)
      .where(eq(productSources.productId, product.id));
    const byKind: Record<string, number> = {};
    for (const s of sources) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
    const thirdParty = sources.length - (byKind.official ?? 0);
    add(1, {
      id: "1.sources",
      label: `≥ ${ACCEPTANCE_TARGETS.minSources} sources incl. ≥ ${ACCEPTANCE_TARGETS.minThirdPartySources} third-party`,
      status:
        sources.length >= ACCEPTANCE_TARGETS.minSources && thirdParty >= ACCEPTANCE_TARGETS.minThirdPartySources
          ? "pass"
          : "fail",
      detail: `${sources.length} sources, ${thirdParty} third-party (any kind other than "official"); ${sources.filter((s) => s.createdByJobId === job.id).length} collected by this job.`,
      evidence: { total: sources.length, thirdParty, byKind },
    });

    const media = await db
      .select({
        id: mediaAssets.id,
        kind: mediaAssets.kind,
        role: mediaAssets.role,
        articleId: mediaAssets.articleId,
        capturedAt: mediaAssets.capturedAt,
        createdAt: mediaAssets.createdAt,
      })
      .from(mediaAssets)
      .where(
        article
          ? or(eq(mediaAssets.productId, product.id), eq(mediaAssets.articleId, article.id))
          : eq(mediaAssets.productId, product.id),
      );
    const shotRoles = new Set(
      media.filter((m) => m.kind === "screenshot" && m.role && !m.role.startsWith("hands_on")).map((m) => m.role!),
    );
    const missingRequired = REQUIRED_SCREENSHOTS.filter((r) => !shotRoles.has(r));
    const missingMobile = OPTIONAL_SCREENSHOTS.filter((r) => !shotRoles.has(r));
    const imageBlocks = version?.blocks.filter((b) => b.type === "image").length ?? 0;
    add(1, {
      id: "1.screenshots",
      label: "Screenshots of home and pricing",
      status: missingRequired.length ? "fail" : missingMobile.length ? "warn" : "pass",
      detail: missingRequired.length
        ? `Missing ${missingRequired.join(", ")}.`
        : missingMobile.length
          ? `Desktop home and pricing captured; mobile missing (${missingMobile.join(", ")}).`
          : `Home and pricing captured at desktop and mobile widths; ${imageBlocks} image blocks in the article.`,
      evidence: { roles: [...shotRoles].sort(), imageBlocks },
    });

    const rubric = version?.blocks.find((b) => b.type === "rubric");
    const dims = rubric && rubric.type === "rubric" ? rubric.dimensions.length : 0;
    const score = version?.overallScore ?? null;
    const { min, max } = ACCEPTANCE_TARGETS.rubricDimensions;
    add(1, {
      id: "1.rubric",
      label: "Rubric scores",
      status: !version || dims === 0 || score === null ? "fail" : dims < min || dims > max ? "warn" : "pass",
      detail: !version
        ? "No article version from this job."
        : dims === 0 || score === null
          ? "No rubric block or no overall score."
          : `${dims} dimensions, overall ${score.toFixed(1)}/10${dims < min || dims > max ? ` (FR-CON-3 expects ${min}–${max})` : ""}.`,
      evidence: { dimensions: dims, overallScore: score },
    });

    const articleMedia = article ? media.filter((m) => m.articleId === article.id) : [];
    const og = articleMedia.find((m) => m.role === "og") ?? null;
    const ogId = og?.id ?? version?.seo?.ogImageAssetId ?? null;
    const pricingCard = articleMedia.find((m) => m.role === "pricing_card") ?? null;
    const missingGraphics = [!ogId && "OG image", !pricingCard && "pricing card"].filter(Boolean);
    add(1, {
      id: "1.graphics",
      label: "OG image and pricing card",
      status: missingGraphics.length ? "fail" : "pass",
      detail: missingGraphics.length
        ? `Missing ${missingGraphics.join(" and ")}${!pricingCard && !latestSheet?.data.pricing?.tiers.value.length ? " (the fact sheet has no pricing tiers, so graphics skips the card)" : ""}.`
        : "Both rendered by the graphics step.",
      evidence: { ogAssetId: ogId, pricingCardAssetId: pricingCard?.id ?? null },
    });

    const fc = version?.factCheck ?? null;
    const scorecard = version?.qaScorecard ?? null;
    const unsupported = fc ? fc.claims.filter((c) => c.verdict === "unsupported").length : null;
    const outdated = fc ? fc.claims.filter((c) => c.verdict === "outdated").length : null;
    const failedHard = scorecard ? scorecard.checks.filter((c) => c.hard && !c.passed).map((c) => c.key) : [];
    add(1, {
      id: "1.fact_check",
      label: "QA scorecard with zero unsupported claims after fact-check",
      status:
        !fc || !scorecard || unsupported! > 0 ? "fail" : outdated! > 0 || !scorecard.hardGatesPassed ? "warn" : "pass",
      detail: !version
        ? "No article version from this job."
        : !fc
          ? "No fact-check report on the version."
          : !scorecard
            ? "No QA scorecard on the version."
            : `${fc.claims.length} claims checked: ${unsupported} unsupported, ${outdated} outdated, ${fc.fixedCount} fixed by the fact-check. Hard gates ${scorecard.hardGatesPassed ? "pass" : `fail (${failedHard.join(", ")})`}.`,
      evidence: {
        versionId: version?.id ?? null,
        claims: fc?.claims.length ?? 0,
        unsupported,
        outdated,
        hardGatesPassed: scorecard?.hardGatesPassed ?? null,
        failedHardGates: failedHard,
      },
    });
  }

  // ---- §8 #2: approved article live with structured data, disclosure and go-link CTAs ----
  if (!article) {
    add(2, {
      id: "2.published",
      label: "Published with structured data, disclosure and go-link CTAs",
      status: "n/a",
      detail: "No article.",
    });
  } else if (article.status !== "published" || !article.publishedVersionId) {
    add(2, {
      id: "2.published",
      label: "Published with structured data, disclosure and go-link CTAs",
      status: "n/a",
      detail: `Article is ${article.status.replace(/_/g, " ")}; approve and publish it, then run ${LIVE_CHECKS}.`,
    });
  } else {
    const [published] = await db
      .select()
      .from(articleVersions)
      .where(eq(articleVersions.id, article.publishedVersionId))
      .limit(1);
    const blocks = published?.blocks ?? [];
    const slugs = goSlugsInBlocks(blocks);
    const known = slugs.length
      ? new Set(
          (await db.select({ slug: goSlugs.slug }).from(goSlugs).where(inArray(goSlugs.slug, slugs))).map(
            (r) => r.slug,
          ),
        )
      : new Set<string>();
    const unknown = slugs.filter((s) => !known.has(s));
    const ctas = blocks.filter((b) => b.type === "cta").length;
    const sd = published?.qaScorecard?.checks.find((c) => c.key === "structured_data");
    const disclosure = (await getSetting(db, "editorial.aiDisclosure"))?.trim();
    const problems = [
      !sd
        ? "no structured-data check on the published version's scorecard"
        : !sd.passed
          ? `structured data invalid (${sd.detail ?? "see scorecard"})`
          : null,
      ctas === 0 ? "no CTA blocks" : null,
      unknown.length ? `CTAs point at unknown go-slugs: ${unknown.join(", ")}` : null,
      !disclosure ? "editorial.aiDisclosure is empty" : null,
    ].filter((p): p is string => !!p);
    add(2, {
      id: "2.published",
      label: "Published with structured data, disclosure and go-link CTAs",
      status: problems.length ? "fail" : "pass",
      detail: `${problems.length ? `${problems.join("; ")}. ` : `Published v${published?.version}: ${ctas} CTAs over /go/${slugs.join(", /go/")}, structured data valid, AI disclosure set. `}Live page, Rich Results and the 60 s revalidation: ${LIVE_CHECKS}.`,
      evidence: {
        publishedVersionId: article.publishedVersionId,
        publishedAt: article.publishedAt,
        ctas,
        goSlugs: slugs,
      },
    });
  }

  // ---- §8 #3 and #4: live behaviour ----
  const productGoSlugs = product
    ? (await db.select({ slug: goSlugs.slug }).from(goSlugs).where(eq(goSlugs.productId, product.id))).map(
        (r) => r.slug,
      )
    : [];
  add(3, {
    id: "3.golink",
    label: "/go/<slug> falls back to vendor URL + UTM, then switches to the affiliate link",
    status: "n/a",
    detail: `Live redirect check: ${LIVE_CHECKS}.${productGoSlugs.length ? ` Product go-slugs: ${productGoSlugs.join(", ")}.` : " The product has no go-slug yet."}`,
    evidence: { goSlugs: productGoSlugs },
  });
  add(4, {
    id: "4.clicks_lighthouse",
    label: "Clicks in the dashboard within 1 min; Lighthouse mobile ≥ 90 perf, ≥ 95 SEO/a11y",
    status: "n/a",
    detail:
      "Live checks: the e2e suite (pnpm e2e) covers click logging and the Lighthouse mobile budget (apps/e2e); pnpm launch-check --site <url> covers the deployed pages.",
  });

  // ---- §8 #5: cost ----
  const [ledger] = await db
    .select({ total: sql<string>`coalesce(sum(${costLedger.costUsd}), 0)`, rows: sql<number>`count(*)::int` })
    .from(costLedger)
    .where(eq(costLedger.jobId, job.id));
  const spent = Number(ledger?.total ?? 0);
  const rows = Number(ledger?.rows ?? 0);
  const targets = (await getSetting(db, "costs.targetPerReviewUsd")) ?? { quick: 5, full: 12 };
  if (rows === 0) {
    add(5, {
      id: "5.cost",
      label: "Cost ledger total for the job",
      status: job.status === "succeeded" ? "warn" : "n/a",
      detail: "No cost ledger rows for this job.",
      evidence: { ledgerUsd: 0, jobTotalUsd: Number(job.totalCostUsd) },
    });
  } else if (job.preset === "quick_review") {
    add(5, {
      id: "5.cost",
      label: `Quick review ≤ ${usd(ACCEPTANCE_TARGETS.quickReviewMaxUsd)}`,
      status: spent <= ACCEPTANCE_TARGETS.quickReviewMaxUsd ? "pass" : "fail",
      detail: `${usd(spent)} over ${rows} ledger rows (SRS §8 limit ${usd(ACCEPTANCE_TARGETS.quickReviewMaxUsd)}; settings target ${usd(targets.quick)}).`,
      evidence: {
        ledgerUsd: spent,
        rows,
        jobTotalUsd: Number(job.totalCostUsd),
        target: ACCEPTANCE_TARGETS.quickReviewMaxUsd,
      },
    });
  } else {
    // SRS §8 caps only quick reviews; other presets are compared with the full-review target (NFR-6).
    const target = targets.full;
    add(5, {
      id: "5.cost",
      label: `Cost within the ${job.preset.replace(/_/g, " ")} target`,
      status: spent <= target ? "pass" : "warn",
      detail: `${usd(spent)} over ${rows} ledger rows vs the costs.targetPerReviewUsd.full target of ${usd(target)}. The SRS §8 hard limit applies to quick reviews only.`,
      evidence: { ledgerUsd: spent, rows, jobTotalUsd: Number(job.totalCostUsd), target },
    });
  }

  // ---- §8 #6: re-running research diffs and never duplicates ----
  if (!product) {
    add(6, { id: "6.rerun", label: "Re-run research: diff, no duplicates", status: "n/a", detail: "No product." });
  } else {
    const sheets = await db
      .select({
        id: factSheets.id,
        version: factSheets.version,
        diff: factSheets.diffFromPrevious,
        jobId: factSheets.createdByJobId,
      })
      .from(factSheets)
      .where(eq(factSheets.productId, product.id))
      .orderBy(desc(factSheets.version));
    const researchRuns = new Set(sheets.map((s) => s.jobId).filter(Boolean)).size;
    if (sheets.length < 2) {
      add(6, {
        id: "6.rerun",
        label: "Re-run research: diff, no duplicates",
        status: "n/a",
        detail: "One research run so far. Re-run research (or refresh) on this product to check.",
        evidence: { factSheetVersions: sheets.length },
      });
    } else {
      const rerun = sheets.find((s) => s.jobId === job.id && s.version >= 2) ?? sheets[0]!;
      const sameDomain = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.domain, product.domain), eq(products.locale, product.locale)));
      const reviewArticles = await db
        .select({ id: articles.id, locale: articles.locale })
        .from(articles)
        .where(and(eq(articles.productId, product.id), eq(articles.type, "review")));
      const perLocale: Record<string, number> = {};
      for (const a of reviewArticles) perLocale[a.locale] = (perLocale[a.locale] ?? 0) + 1;
      const dupLocales = Object.entries(perLocale)
        .filter(([, n]) => n > 1)
        .map(([l]) => l);
      const problems = [
        rerun.diff === null ? `fact sheet v${rerun.version} has no diff against v${rerun.version - 1}` : null,
        sameDomain.length > 1 ? `${sameDomain.length} products share ${product.domain}` : null,
        dupLocales.length ? `more than one review article for locale ${dupLocales.join(", ")}` : null,
      ].filter((p): p is string => !!p);
      add(6, {
        id: "6.rerun",
        label: "Re-run research: diff, no duplicates",
        status: problems.length ? "fail" : "pass",
        detail: problems.length
          ? `${problems.join("; ")}.`
          : `Fact sheet v${rerun.version} lists ${rerun.diff!.length} changed fields vs v${rerun.version - 1}; one product for ${product.domain} and one review per locale across ${sheets.length} fact-sheet versions.`,
        evidence: {
          factSheetVersions: sheets.length,
          researchRuns,
          diffVersion: rerun.version,
          changedFields: rerun.diff?.map((d) => d.path) ?? null,
          productsForDomain: sameDomain.length,
          reviewArticlesPerLocale: perLocale,
        },
      });
    }
  }

  return {
    jobId: job.id,
    preset: job.preset,
    jobStatus: job.status,
    createdAt: job.createdAt,
    productId: product?.id ?? null,
    productName: product?.name ?? null,
    articleId: article?.id ?? null,
    articleTitle: article?.title ?? null,
    articleStatus: article?.status ?? null,
    criteria,
    summary: countStatuses(criteria),
  };
}

export type AcceptanceCandidate = {
  jobId: string;
  preset: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  productId: string | null;
  productName: string | null;
  articleId: string | null;
  articleTitle: string | null;
  articleStatus: string | null;
  articleSlug: string | null;
  articleLocale: string | null;
};

/** Recent finished review jobs (succeeded or failed) with their product and article. */
export async function listAcceptanceCandidates(
  db: DbOrTx,
  opts: { limit?: number } = {},
): Promise<AcceptanceCandidate[]> {
  return db
    .select({
      jobId: reviewJobs.id,
      preset: reviewJobs.preset,
      status: reviewJobs.status,
      createdAt: reviewJobs.createdAt,
      finishedAt: reviewJobs.finishedAt,
      productId: reviewJobs.productId,
      productName: products.name,
      articleId: articles.id,
      articleTitle: articles.title,
      articleStatus: articles.status,
      articleSlug: articles.slug,
      articleLocale: articles.locale,
    })
    .from(reviewJobs)
    .leftJoin(products, eq(products.id, reviewJobs.productId))
    .leftJoin(articles, eq(articles.id, reviewJobs.articleId))
    .where(
      and(inArray(reviewJobs.preset, [...ACCEPTANCE_PRESETS]), inArray(reviewJobs.status, ["succeeded", "failed"])),
    )
    .orderBy(desc(reviewJobs.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 100));
}
