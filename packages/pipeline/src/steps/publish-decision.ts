import { articlePath, type QaScorecard } from "@repo/content";
import {
  afterPublish,
  DomainError,
  getArticle,
  getCurrentVersion,
  getSetting,
  notify,
  publishArticle,
  transitionArticle,
} from "@repo/core";
import { categories, eq, inArray, products, type DbOrTx } from "@repo/db";
import { z } from "zod";
import { defineStep } from "../step";

/** Share of soft (non-blocking) QA checks that pass, 0–1 (FR-QA-4 "soft score"). */
export function softScore(scorecard: QaScorecard): number {
  const soft = scorecard.checks.filter((c) => !c.hard);
  return soft.length === 0 ? 1 : soft.filter((c) => c.passed).length / soft.length;
}

/** Category slugs an article belongs to: its own (lists) or its products' (reviews, comparisons). */
async function articleCategorySlugs(
  db: DbOrTx,
  article: { categoryId: string | null; productIds: string[]; productId: string | null },
) {
  const slugs = new Set<string>();
  if (article.categoryId) {
    const [c] = await db
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.id, article.categoryId));
    if (c) slugs.add(c.slug);
  }
  const ids = article.productIds.length ? article.productIds : article.productId ? [article.productId] : [];
  if (ids.length) {
    const rows = await db
      .select({ slug: categories.slug })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(inArray(products.id, ids));
    for (const r of rows) slugs.add(r.slug);
  }
  return [...slugs];
}

/** Next 09:00 UTC after `now`, for articles that hit the daily cap (NFR-10). */
export function nextPublishSlot(now: Date): Date {
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 9));
  return slot;
}

export type AutoPublishVerdict = { eligible: true } | { eligible: false; reason: string };

/**
 * FR-QA-4: publish without human review only when the global "require human review" switch is
 * off, every category of the article is opted in, all hard gates pass and the soft score clears
 * the threshold. Off by default (D-3).
 */
export function autoPublishVerdict(input: {
  requireHumanReview: boolean;
  autoCategories: string[];
  articleCategories: string[];
  scorecard: QaScorecard | null;
  minSoftScore: number;
}): AutoPublishVerdict {
  if (input.requireHumanReview) return { eligible: false, reason: "human review is required (Settings)" };
  if (input.articleCategories.length === 0) return { eligible: false, reason: "article has no category" };
  const missing = input.articleCategories.filter((c) => !input.autoCategories.includes(c));
  if (missing.length) return { eligible: false, reason: `auto-publish is off for ${missing.join(", ")}` };
  if (!input.scorecard?.hardGatesPassed) return { eligible: false, reason: "hard quality gates failed" };
  const score = softScore(input.scorecard);
  if (score < input.minSoftScore) {
    return {
      eligible: false,
      reason: `soft score ${Math.round(score * 100)}% < ${Math.round(input.minSoftScore * 100)}%`,
    };
  }
  return { eligible: true };
}

/**
 * publish (FR-QA-2, FR-QA-4): the last pipeline step. Auto-publishes when the rules allow it
 * (scheduling for tomorrow when the daily cap is reached); otherwise leaves the article in review
 * and notifies the editor.
 */
export const publishDecisionStep = defineStep({
  name: "publish",
  input: z.object({ articleId: z.uuid() }),
  output: z.object({
    action: z.enum(["published", "scheduled", "review"]),
    reason: z.string(),
    softScore: z.number(),
  }),
  async run(ctx, input) {
    const article = await getArticle(ctx.db, input.articleId);
    const version = await getCurrentVersion(ctx.db, input.articleId);
    if (!article || !version) throw new Error("Article or version not found");
    const [requireHumanReview, autoCategories, rule] = await Promise.all([
      getSetting(ctx.db, "publishing.requireHumanReview"),
      getSetting(ctx.db, "publishing.autoPublishCategories"),
      getSetting(ctx.db, "publishing.autoPublish"),
    ]);
    const verdict = autoPublishVerdict({
      requireHumanReview: requireHumanReview ?? true,
      autoCategories: autoCategories ?? [],
      articleCategories: await articleCategorySlugs(ctx.db, article),
      scorecard: version.qaScorecard,
      minSoftScore: rule?.minSoftScore ?? 0.85,
    });
    const score = version.qaScorecard ? softScore(version.qaScorecard) : 0;
    const path = articlePath(article.type, article.slug);

    if (verdict.eligible) {
      if (article.status !== "approved") await transitionArticle(ctx.db, article.id, "approved");
      try {
        await publishArticle(ctx.db, article.id);
      } catch (error) {
        if (!(error instanceof DomainError && error.code === "conflict")) throw error;
        const when = nextPublishSlot(new Date());
        await transitionArticle(ctx.db, article.id, "scheduled", { scheduledFor: when });
        ctx.log("daily cap reached; scheduled", { when: when.toISOString() });
        await notify(ctx.db, {
          event: "article.auto_published",
          title: `Auto-approved and scheduled: ${article.title}`,
          body: `The daily publishing cap was reached, so it goes live ${when.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
          href: `/articles/${article.id}`,
          entityType: "article",
          entityId: article.id,
          dedupeKey: `article.auto_published:${version.id}`,
        });
        return { output: { action: "scheduled" as const, reason: "daily cap reached", softScore: score } };
      }
      const effects = await afterPublish(ctx.db, article.id, ctx.publishEnv, ctx.fetch);
      ctx.log("auto-published", { revalidate: effects.revalidate, indexNow: effects.indexNow });
      await notify(ctx.db, {
        event: "article.auto_published",
        title: `Auto-published: ${article.title}`,
        body: `All hard gates passed and ${Math.round(score * 100)}% of soft checks. Live at ${ctx.publishEnv.siteUrl.replace(/\/$/, "")}${path}`,
        href: `/articles/${article.id}`,
        entityType: "article",
        entityId: article.id,
        dedupeKey: `article.auto_published:${version.id}`,
      });
      return { output: { action: "published" as const, reason: "auto-publish rules met", softScore: score } };
    }

    const failed = version.qaScorecard?.checks.filter((c) => c.hard && !c.passed).map((c) => c.label) ?? [];
    await notify(ctx.db, {
      event: "article.awaiting_review",
      title: `Ready for review: ${article.title}`,
      body: [
        `Version ${version.version}. ${verdict.reason}.`,
        failed.length ? `Blocking before publish: ${failed.join("; ")}.` : "All hard gates pass.",
        version.changeNote ?? "",
      ]
        .filter(Boolean)
        .join(" "),
      href: `/articles/${article.id}`,
      entityType: "article",
      entityId: article.id,
      dedupeKey: `article.awaiting_review:${version.id}`,
    });
    return { output: { action: "review" as const, reason: verdict.reason, softScore: score } };
  },
});
