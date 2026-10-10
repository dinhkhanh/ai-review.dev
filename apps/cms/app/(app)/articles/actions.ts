"use server";

import {
  addArticleVersion,
  addComment,
  afterPublish,
  DomainError,
  getArticle,
  getCurrentVersion,
  latestFactSheet,
  listSourcesForProducts,
  articleProductIds,
  publishArticle,
  publishEnvFromProcess,
  recordAudit,
  resolveComment,
  rollbackToVersion,
  setVersionQa,
  sourceRefs,
  transitionArticle,
  updateArticleMeta,
  type ArticleStatus,
} from "@repo/core";
import { blockingClaims, factCheckReportSchema } from "@repo/content";
import { getDb } from "@repo/db";
import {
  computeQaScorecard,
  pricingTableFromFactSheet,
  recheckBlocks,
  regenerateSection,
  SECTION_KEYS,
  type SectionKey,
} from "@repo/pipeline/editor";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";
import { revalidateArticle } from "../../../lib/cache";
import { applyEditorForm } from "../../../lib/editor-form";
import { dispatchJob } from "../../../lib/dispatch";
import { cmsServices } from "../../../lib/services";

export type ActionState = { ok: boolean; message: string } | null;

function fail(error: unknown): ActionState {
  if (error instanceof DomainError) return { ok: false, message: error.message };
  return { ok: false, message: error instanceof Error ? error.message : String(error) };
}

async function refreshQa(articleId: string, versionId: string) {
  const qaScorecard = await computeQaScorecard(getDb(), articleId, versionId);
  await setVersionQa(getDb(), versionId, { qaScorecard });
  return qaScorecard;
}

/** Saves all block edits as one new version and recomputes QA (FR-CMS-5, FR-CON-11). */
export async function saveBlocksAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  const db = getDb();
  try {
    const article = await getArticle(db, articleId);
    const version = await getCurrentVersion(db, articleId);
    if (!article || !version) throw new DomainError("not_found", "Article not found");
    if (String(form.get("baseVersionId")) !== version.id) {
      return {
        ok: false,
        message: "A newer version exists (someone or the pipeline saved meanwhile). Reload before editing.",
      };
    }
    const refs = sourceRefs(await listSourcesForProducts(db, articleProductIds(article)));
    const { blocks, changed } = applyEditorForm(version.blocks, form, refs);
    if (changed.length === 0) return { ok: true, message: "No changes" };
    // Human edits are the editor's responsibility: drop fact-check findings for edited blocks.
    const factCheck = version.factCheck
      ? factCheckReportSchema.parse({
          ...version.factCheck,
          claims: version.factCheck.claims.filter((c) => !changed.includes(c.blockId)),
          supported: 0,
          unsupported: 0,
          outdated: 0,
          uncited: 0,
          fixedCount: 0,
        })
      : null;
    if (factCheck) {
      factCheck.supported = factCheck.claims.filter((c) => c.verdict === "supported").length;
      factCheck.unsupported = factCheck.claims.filter((c) => c.verdict === "unsupported").length;
      factCheck.outdated = factCheck.claims.filter((c) => c.verdict === "outdated").length;
      factCheck.uncited = factCheck.claims.filter((c) => c.verdict === "uncited").length;
      factCheck.fixedCount = factCheck.claims.filter((c) => c.fixed).length;
    }
    const rubric = blocks.find((b) => b.type === "rubric");
    const verdict = blocks.find((b) => b.type === "verdict");
    const saved = await addArticleVersion(db, articleId, {
      blocks,
      seo: version.seo,
      overallScore: verdict?.type === "verdict" && rubric ? verdict.score : version.overallScore,
      factCheck,
      promptVersions: version.promptVersions,
      userId: user.id,
      changeNote: `Edited ${changed.length} block${changed.length === 1 ? "" : "s"} (${user.email})`,
    });
    const qa = await refreshQa(articleId, saved.id);
    await recordAudit(db, {
      actorUserId: user.id,
      action: "article.edit",
      entityType: "article",
      entityId: articleId,
      data: { version: saved.version, changed },
    });
    revalidatePath(`/articles/${articleId}`);
    return { ok: true, message: `Saved v${saved.version}. Hard gates ${qa.hardGatesPassed ? "pass" : "fail"}.` };
  } catch (error) {
    return fail(error);
  }
}

/** "Regenerate this section with instruction" (FR-QA-3), then fact-check the new text. */
export async function regenerateSectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  const section = String(form.get("section")) as SectionKey;
  const instruction = String(form.get("instruction") ?? "").trim();
  if (!(SECTION_KEYS as readonly string[]).includes(section)) return { ok: false, message: "Unknown section" };
  if (instruction.length < 5) return { ok: false, message: "Tell the writer what to change" };
  try {
    const services = cmsServices();
    const { version, cost } = await regenerateSection(services, { articleId, section, instruction, userId: user.id });
    const ids = version.blocks.filter((b) => b.id.startsWith(`sec-${section}-`)).map((b) => b.id);
    const { factCheck, qaScorecard } = await recheckBlocks(services, articleId, version.id, ids);
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: "article.regenerate_section",
      entityType: "article",
      entityId: articleId,
      data: { section, instruction },
    });
    revalidatePath(`/articles/${articleId}`);
    const blocking = blockingClaims(factCheck).filter((c) => ids.includes(c.blockId)).length;
    return {
      ok: true,
      message: `Regenerated "${section}" as v${version.version} ($${cost.toFixed(3)}). ${blocking ? `${blocking} claim(s) need attention.` : "Fact-check passed."} Gates ${qaScorecard.hardGatesPassed ? "pass" : "fail"}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

/** Rebuilds the pricing table from the latest fact sheet (after editing pricing facts). */
export async function rebuildPricingAction(form: FormData) {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  const db = getDb();
  const article = await getArticle(db, articleId);
  const version = await getCurrentVersion(db, articleId);
  if (!article?.productId || !version) return;
  const sheet = await latestFactSheet(db, article.productId);
  const table = pricingTableFromFactSheet(sheet?.data ?? null, sheet?.createdAt ?? new Date());
  if (!table) return;
  const blocks = version.blocks.map((b) => (b.type === "pricing_table" ? table : b));
  const saved = await addArticleVersion(db, articleId, {
    blocks,
    seo: version.seo,
    overallScore: version.overallScore,
    factCheck: version.factCheck,
    promptVersions: version.promptVersions,
    userId: user.id,
    changeNote: `Pricing table rebuilt from fact sheet v${sheet?.version}`,
  });
  await updateArticleMeta(db, articleId, { lastVerifiedAt: sheet?.createdAt ?? new Date() });
  await refreshQa(articleId, saved.id);
  revalidatePath(`/articles/${articleId}`);
}

export async function rerunQaAction(form: FormData) {
  await requireUser();
  const articleId = String(form.get("articleId"));
  const version = await getCurrentVersion(getDb(), articleId);
  if (version) await refreshQa(articleId, version.id);
  revalidatePath(`/articles/${articleId}`);
}

/** Review state machine (FR-QA-2). */
export async function transitionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  const to = String(form.get("to")) as ArticleStatus;
  const db = getDb();
  try {
    if (to === "published") {
      await publishArticle(db, articleId);
      const effects = await afterPublish(db, articleId, publishEnvFromProcess());
      await recordAudit(db, {
        actorUserId: user.id,
        action: "article.publish",
        entityType: "article",
        entityId: articleId,
        data: effects,
      });
      // Auto-translations queued by the publish hook (i18n.policy.autoTranslate) start right away.
      for (const jobId of effects.translationJobs) await dispatchJob(jobId);
      revalidatePath(`/articles/${articleId}`);
      return {
        ok: true,
        message: `Published. Revalidation ${effects.revalidate.ok ? "sent" : `failed (${effects.revalidate.error ?? effects.revalidate.status})`}; IndexNow ${effects.indexNow.ok ? "pinged" : "skipped"}${effects.translationJobs.length ? `; ${effects.translationJobs.length} translation(s) queued` : ""}.`,
      };
    }
    const scheduledFor = form.get("scheduledFor") ? new Date(String(form.get("scheduledFor"))) : null;
    const before = await getArticle(db, articleId);
    await transitionArticle(db, articleId, to, { scheduledFor });
    if (to === "archived" && before?.publishedVersionId) await revalidateArticle(articleId);
    await recordAudit(db, {
      actorUserId: user.id,
      action: `article.${to}`,
      entityType: "article",
      entityId: articleId,
    });
    revalidatePath(`/articles/${articleId}`);
    return { ok: true, message: `Moved to ${to.replace(/_/g, " ")}` };
  } catch (error) {
    return fail(error);
  }
}

export async function saveSeoAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  const db = getDb();
  try {
    const version = await getCurrentVersion(db, articleId);
    if (!version) throw new DomainError("not_found", "Article has no content");
    const title = String(form.get("title") ?? "").trim();
    const seo = {
      ...(version.seo ?? { secondaryKeywords: [], internalLinks: [], intent: "review" as const, primaryKeyword: "" }),
      title: String(form.get("seoTitle") ?? "")
        .trim()
        .slice(0, 70),
      metaDescription: String(form.get("metaDescription") ?? "")
        .trim()
        .slice(0, 170),
      primaryKeyword: String(form.get("primaryKeyword") ?? "").trim(),
    };
    const saved = await addArticleVersion(db, articleId, {
      blocks: version.blocks,
      seo,
      overallScore: version.overallScore,
      factCheck: version.factCheck,
      promptVersions: version.promptVersions,
      userId: user.id,
      changeNote: "SEO edited",
    });
    await updateArticleMeta(db, articleId, {
      ...(title ? { title } : {}),
      slug: String(form.get("slug") ?? "").trim() || undefined,
    });
    await refreshQa(articleId, saved.id);
    await recordAudit(db, { actorUserId: user.id, action: "article.seo", entityType: "article", entityId: articleId });
    revalidatePath(`/articles/${articleId}`);
    return { ok: true, message: `Saved v${saved.version}` };
  } catch (error) {
    return fail(error);
  }
}

export async function rollbackAction(form: FormData) {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  const saved = await rollbackToVersion(getDb(), articleId, String(form.get("versionId")), user.id);
  await refreshQa(articleId, saved.id);
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "article.rollback",
    entityType: "article",
    entityId: articleId,
    data: { to: saved.version },
  });
  revalidatePath(`/articles/${articleId}`);
}

export async function addCommentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  try {
    await addComment(getDb(), {
      articleId,
      versionId: String(form.get("versionId") ?? "") || null,
      blockId: String(form.get("blockId") ?? "") || null,
      body: String(form.get("body") ?? ""),
      userId: user.id,
    });
    revalidatePath(`/articles/${articleId}`);
    return { ok: true, message: "Comment added" };
  } catch (error) {
    return fail(error);
  }
}

export async function resolveCommentAction(form: FormData) {
  await requireUser();
  await resolveComment(getDb(), String(form.get("commentId")), form.get("resolved") !== "0");
  revalidatePath(`/articles/${String(form.get("articleId"))}`);
}
