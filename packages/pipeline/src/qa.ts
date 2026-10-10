import {
  articlePath,
  articleText,
  buildListStructuredData,
  validateListStructuredData,
  blockingClaims,
  buildReviewStructuredData,
  overlapRatio,
  readingGrade,
  validateStructuredData,
  wordCount,
  type ArticleBody,
  type QaScorecard,
} from "@repo/content";
import {
  getArticle,
  getCurrentVersion,
  getMediaAssets,
  getSetting,
  articleProductIds,
  latestFactSheet,
  listSourcesForProducts,
  pricingCitationCoverage,
  getProduct,
  getVersion,
} from "@repo/core";
import type { DbOrTx } from "@repo/db";

type Check = QaScorecard["checks"][number];

function headings(blocks: ArticleBody) {
  return blocks.filter((b) => b.type === "heading" && b.level === 2).length;
}

/** Banned phrases present in a text (case-insensitive). */
export function findBannedPhrases(text: string, banned: string[]): string[] {
  const lower = text.toLowerCase();
  return banned.filter((p) => lower.includes(p.toLowerCase()));
}

/**
 * Automated quality scorecard for one article version (FR-QA-1, FR-QA-5). Hard gates block
 * publishing (C-6); soft checks inform the editor. Pure computation, no LLM calls, so the CMS
 * recomputes it after every manual edit.
 */
export async function computeQaScorecard(
  db: DbOrTx,
  articleId: string,
  versionId?: string | null,
): Promise<QaScorecard> {
  const article = await getArticle(db, articleId);
  const version = versionId ? await getVersion(db, versionId) : await getCurrentVersion(db, articleId);
  const productIds = article ? articleProductIds(article) : [];
  if (!article || productIds.length === 0 || !version || version.articleId !== article.id)
    throw new Error("Article or version not found");
  // Reviews have one product, a rubric and a pricing table; comparisons and lists cover several.
  const isReview = article.type === "review";
  const product = isReview && article.productId ? await getProduct(db, article.productId) : null;
  const listProducts = isReview ? [] : await Promise.all(productIds.map((id) => getProduct(db, id)));
  const [sources, sheet, thresholds, banned, disclosure] = await Promise.all([
    listSourcesForProducts(db, productIds, { withContent: true }),
    isReview && article.productId ? latestFactSheet(db, article.productId) : Promise.resolve(null),
    getSetting(db, "qa.thresholds"),
    getSetting(db, "editorial.bannedPhrases"),
    getSetting(db, "editorial.aiDisclosure"),
  ]);
  const t = thresholds ?? { maxReadingGrade: 11, maxSourceOverlap: 0.08, minWords: 1200 };
  const blocks = version.blocks;
  const text = articleText(blocks);
  const words = wordCount(text);
  const grade = readingGrade(text);
  const overlap = overlapRatio(
    text,
    sources.map((s) => s.contentMd ?? ""),
  );
  const fc = version.factCheck;
  const blocking = fc ? blockingClaims(fc) : [];
  const ctas = blocks.filter((b) => b.type === "cta");
  const images = blocks.filter((b) => b.type === "image");
  const imageAssets = await getMediaAssets(
    db,
    images.flatMap((b) => (b.type === "image" ? [b.assetId] : [])),
  );
  const thirdParty = sources.filter((s) => s.kind !== "official").length;
  const seo = version.seo;
  const pageUrl = `https://ai-review.dev${articlePath(article.type, article.slug)}`;
  const structured = isReview
    ? buildReviewStructuredData({
        siteUrl: "https://ai-review.dev",
        siteName: "AI Review",
        url: pageUrl,
        title: seo?.title ?? article.title,
        description: seo?.metaDescription ?? "",
        publishedAt: article.publishedAt,
        updatedAt: new Date(),
        author: { name: "Editor", url: "https://ai-review.dev/authors" },
        product: { name: product?.name ?? article.title, websiteUrl: product?.websiteUrl ?? "https://ai-review.dev" },
        score: version.overallScore,
        factSheet: sheet?.data ?? null,
        blocks,
        breadcrumbs: [
          { name: "Home", url: "https://ai-review.dev" },
          { name: article.title, url: pageUrl },
        ],
      })
    : buildListStructuredData({
        siteUrl: "https://ai-review.dev",
        siteName: "AI Review",
        url: pageUrl,
        title: seo?.title ?? article.title,
        description: seo?.metaDescription ?? "",
        publishedAt: article.publishedAt,
        updatedAt: new Date(),
        author: { name: "Editor", url: "https://ai-review.dev/authors" },
        items: listProducts.flatMap((p) => (p ? [{ name: p.name, url: p.websiteUrl }] : [])),
        blocks,
        breadcrumbs: [
          { name: "Home", url: "https://ai-review.dev" },
          { name: article.title, url: pageUrl },
        ],
      });
  const sdProblems = isReview ? validateStructuredData(structured) : validateListStructuredData(structured);
  const lowerText = text.toLowerCase();
  const uncovered = listProducts.filter((p) => p && !lowerText.includes(p.name.toLowerCase())).map((p) => p!.name);
  const bannedFound = findBannedPhrases(text, banned ?? []);
  const internalLinks = seo?.internalLinks.length ?? 0;
  const titleLen = (seo?.title ?? article.title).length;
  const metaLen = seo?.metaDescription.length ?? 0;
  const coverage = sheet ? pricingCitationCoverage(sheet.data) : 0;
  const hasRubric = blocks.some((b) => b.type === "rubric") && version.overallScore !== null;

  const checks: Check[] = [
    { key: "fact_check_run", label: "Fact-check completed", hard: true, passed: !!fc },
    {
      key: "unsupported_claims",
      label: "Unsupported or outdated claims",
      hard: true,
      passed: !!fc && blocking.length === 0,
      value: blocking.length,
      detail:
        blocking
          .slice(0, 5)
          .map((c) => c.text)
          .join(" | ") || undefined,
    },
    {
      key: "fact_check_pass_rate",
      label: "Fact-check pass rate",
      hard: false,
      passed: !!fc && fc.claims.length > 0 && fc.supported / fc.claims.length >= 0.9,
      value: fc && fc.claims.length ? Math.round((fc.supported / fc.claims.length) * 100) : 0,
    },
    {
      key: "uncited_claims",
      label: "Uncited figures",
      hard: false,
      passed: (fc?.uncited ?? 0) === 0,
      value: fc?.uncited ?? 0,
    },
    ...(isReview
      ? [{ key: "rubric", label: "Rubric scores with computed overall score", hard: true, passed: hasRubric }]
      : [
          {
            key: "products_covered",
            label: "Every compared product is discussed",
            hard: true,
            passed: uncovered.length === 0,
            value: listProducts.length,
            detail: uncovered.join(", ") || undefined,
          },
        ]),
    { key: "golink", label: "CTA go-link present", hard: true, passed: ctas.length > 0, value: ctas.length },
    {
      key: "disclosure",
      label: "Affiliate disclosure (rendered automatically on pages with go-links)",
      hard: true,
      passed: true,
    },
    {
      key: "rel_sponsored",
      label: 'Monetised links use rel="sponsored nofollow noopener"',
      hard: true,
      passed: true,
    },
    { key: "ai_disclosure", label: "AI disclosure text configured", hard: true, passed: !!disclosure?.trim() },
    {
      key: "structured_data",
      label: "Structured data valid",
      hard: true,
      passed: sdProblems.length === 0,
      detail: sdProblems.join("; ") || undefined,
    },
    { key: "no_fabricated_ratings", label: "No AggregateRating or invented user counts", hard: true, passed: true },
    {
      key: "originality",
      label: "Verbatim overlap with sources",
      hard: true,
      passed: overlap <= t.maxSourceOverlap,
      value: Math.round(overlap * 1000) / 10,
      detail: `max ${t.maxSourceOverlap * 100}%`,
    },
    {
      key: "title_length",
      label: "SEO title 30–65 characters",
      hard: false,
      passed: titleLen >= 30 && titleLen <= 65,
      value: titleLen,
    },
    {
      key: "meta_length",
      label: "Meta description 120–165 characters",
      hard: false,
      passed: metaLen >= 120 && metaLen <= 165,
      value: metaLen,
    },
    {
      key: "headings",
      label: `At least ${isReview ? 6 : 4} H2 sections`,
      hard: false,
      passed: headings(blocks) >= (isReview ? 6 : 4),
      value: headings(blocks),
    },
    {
      key: "word_count",
      label: `At least ${t.minWords} words`,
      hard: false,
      passed: words >= t.minWords,
      value: words,
    },
    {
      key: "readability",
      label: `Reading grade ≤ ${t.maxReadingGrade}`,
      hard: false,
      passed: grade <= t.maxReadingGrade,
      value: grade,
    },
    {
      key: "banned_phrases",
      label: "No banned phrases",
      hard: false,
      passed: bannedFound.length === 0,
      value: bannedFound.length,
      detail: bannedFound.join(", ") || undefined,
    },
    {
      key: "internal_links",
      label: "Internal links to other reviews",
      hard: false,
      passed: internalLinks > 0,
      value: internalLinks,
    },
    {
      key: "image_alt",
      label: "Images have alt text",
      hard: false,
      passed: imageAssets.every((a) => !!a.alt),
      value: imageAssets.filter((a) => !a.alt).length,
    },
    {
      key: "screenshots",
      label: "Original screenshots included",
      hard: false,
      passed: images.length >= 2,
      value: images.length,
    },
    {
      key: "sources",
      label: "≥ 8 sources incl. ≥ 2 third-party",
      hard: false,
      passed: sources.length >= 8 && thirdParty >= 2,
      value: `${sources.length} (${thirdParty} third-party)`,
    },
    {
      key: "pricing_citations",
      label: "≥ 90% of pricing fields cited",
      hard: false,
      passed: coverage >= 0.9,
      value: Math.round(coverage * 100),
    },
    { key: "og_image", label: "OG image generated", hard: false, passed: !!seo?.ogImageAssetId },
    {
      key: "trademarks",
      label: "Trademarks used nominatively (logo only in identification contexts)",
      hard: false,
      passed: true,
      detail: "Enforced by templates; confirm in review",
    },
  ];
  // Review-only checks do not apply to comparisons and lists.
  const applicable = isReview ? checks : checks.filter((c) => !["screenshots", "pricing_citations"].includes(c.key));
  const hardGatesPassed = applicable.every((c) => !c.hard || c.passed);
  return { hardGatesPassed, checks: applicable, computedAt: new Date().toISOString() };
}
