import { addArticleVersion, getArticle, getCurrentVersion, latestFactSheet, type FactChange } from "@repo/core";
import { z } from "zod";
import { pricingTableFromFactSheet, SECTION_KEYS, type SectionKey } from "../article-builder";
import { rewriteSectionBlocks } from "../section";
import { defineStep } from "../step";

/** Fact-sheet paths that do not change what the article says (rating counts move every day). */
const IMMATERIAL = /^ratings(\[|$)/;

/** Which review sections describe a changed fact-sheet path (FR-MNT-1 "regenerates affected sections"). */
export function sectionForPath(path: string): SectionKey | null {
  if (IMMATERIAL.test(path)) return null;
  if (path.startsWith("pricing")) return "pricing";
  if (/^(features|integrations|platforms)/.test(path)) return "features";
  if (path.startsWith("security")) return "security";
  if (path.startsWith("support")) return "support";
  if (/^(tagline|company|name|website|limitations)/.test(path)) return "overview";
  return "overview";
}

export interface RefreshPlan {
  material: boolean;
  pricingChanged: boolean;
  sections: SectionKey[];
  changes: FactChange[];
}

export function planRefresh(changes: FactChange[]): RefreshPlan {
  const material = changes.filter((c) => sectionForPath(c.path) !== null);
  const sections = new Set(material.map((c) => sectionForPath(c.path)!));
  return {
    material: material.length > 0,
    pricingChanged: material.some((c) => c.path.startsWith("pricing")),
    sections: SECTION_KEYS.filter((k) => sections.has(k)),
    changes: material,
  };
}

const show = (v: unknown) => (v === null || v === undefined ? "—" : JSON.stringify(v).slice(0, 300));

/** refresh_plan (FR-MNT-1, FR-RES-9): material fact changes since the last fact sheet, and the sections they touch. */
export const refreshPlanStep = defineStep({
  name: "refresh_plan",
  input: z.object({ productId: z.uuid() }),
  output: z.object({
    material: z.boolean(),
    pricingChanged: z.boolean(),
    sections: z.array(z.enum(SECTION_KEYS)),
    changes: z.array(z.object({ path: z.string(), before: z.unknown(), after: z.unknown() })),
    factSheetVersion: z.number(),
  }),
  async run(ctx, input) {
    const sheet = await latestFactSheet(ctx.db, input.productId);
    if (!sheet) throw new Error("No fact sheet; research did not complete");
    const plan = planRefresh(sheet.diffFromPrevious ?? []);
    ctx.log("refresh plan", {
      material: plan.material,
      sections: plan.sections,
      changes: plan.changes.map((c) => c.path).slice(0, 30),
    });
    return { output: { ...plan, factSheetVersion: sheet.version } };
  },
});

/**
 * refresh_rewrite (FR-MNT-1, FR-MNT-2): rewrites only the sections touched by material changes and
 * rebuilds the pricing table from the new fact sheet, as a new version. Fact-check and QA run next;
 * the published version stays live until the refresh is approved.
 */
export const refreshRewriteStep = defineStep({
  name: "refresh_rewrite",
  input: z.object({ articleId: z.uuid() }),
  output: z.object({ versionId: z.string(), version: z.number(), sections: z.array(z.string()) }),
  async run(ctx, input) {
    const plan = await ctx.previous<RefreshPlan>("refresh_plan");
    if (!plan) throw new Error("refresh_plan output missing");
    const article = await getArticle(ctx.db, input.articleId);
    const version = await getCurrentVersion(ctx.db, input.articleId);
    if (!article?.productId || !version) throw new Error("Article or version not found");
    const sheet = await latestFactSheet(ctx.db, article.productId);
    if (!sheet) throw new Error("No fact sheet");

    let blocks = version.blocks;
    if (plan.pricingChanged) {
      const table = pricingTableFromFactSheet(sheet.data, sheet.createdAt);
      if (table) {
        const at = blocks.findIndex((b) => b.type === "pricing_table");
        blocks = at > -1 ? blocks.map((b, i) => (i === at ? table : b)) : blocks;
      }
    }

    const prompt = await ctx.prompt("section_regenerate");
    const rewritten: string[] = [];
    for (const section of plan.sections) {
      if (!blocks.some((b) => b.id.startsWith(`sec-${section}-`))) continue;
      const relevant = plan.changes.filter((c) => sectionForPath(c.path) === section);
      const instruction = [
        `Refresh for accuracy as of ${new Date().toISOString().slice(0, 10)}. These facts changed since the last version:`,
        ...relevant.slice(0, 25).map((c) => `- ${c.path}: ${show(c.before)} → ${show(c.after)}`),
        "Update the section so every statement matches the new facts, with citations. Keep the structure, tone and anything still accurate.",
      ].join("\n");
      blocks = await rewriteSectionBlocks(
        { db: ctx.db, llm: ctx.llm, embedder: ctx.embedder, prompt },
        { articleTitle: article.title, productId: article.productId, blocks, section, instruction },
      );
      rewritten.push(section);
    }

    const saved = await addArticleVersion(ctx.db, article.id, {
      blocks,
      seo: version.seo,
      overallScore: version.overallScore,
      promptVersions: { ...version.promptVersions, section_regenerate: prompt.version },
      jobId: ctx.jobId,
      changeNote: `Refresh: ${plan.changes.length} fact change(s); rewrote ${rewritten.join(", ") || "no sections"}${plan.pricingChanged ? "; pricing table rebuilt" : ""}`,
    });
    ctx.log("refresh version saved", { version: saved.version, sections: rewritten });
    return {
      output: { versionId: saved.id, version: saved.version, sections: rewritten },
      promptVersion: prompt.version,
    };
  },
});
