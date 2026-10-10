import { extractClaims, type ArticleBody } from "@repo/content";
import { addArticleVersion, getArticle, getCurrentVersion, listSources, sourceRefs } from "@repo/core";
import { z } from "zod";
import { applyLines, blockToLines, isEditable } from "../article-lines";
import { bestWindow, buildReport, fixSchema, gatherEvidence, toChecked, verifyClaims } from "../fact-check-core";
import { defineStep } from "../step";

/**
 * fact_check (FR-CON-4/5): verify every cited or numeric claim against source text; repair blocks
 * with unsupported, outdated or uncited claims (cite, correct or remove); verify the repaired
 * blocks again. Whatever is still unsupported blocks publication via the QA gates.
 */
export const factCheckStep = defineStep({
  name: "fact_check",
  input: z.object({ articleId: z.uuid() }),
  output: z.object({
    versionId: z.string(),
    claims: z.number(),
    supported: z.number(),
    unsupported: z.number(),
    outdated: z.number(),
    uncited: z.number(),
    fixed: z.number(),
  }),
  async run(ctx, input) {
    const article = await getArticle(ctx.db, input.articleId);
    const version = await getCurrentVersion(ctx.db, input.articleId);
    if (!article?.productId || !version) throw new Error("Article or version not found");
    const sources = await listSources(ctx.db, article.productId);
    const refs = sourceRefs(sources);

    const claims = extractClaims(version.blocks);
    const evidence = await gatherEvidence(ctx, article.productId, claims);
    const verdicts = await verifyClaims(ctx, claims, evidence, refs);
    let checked = toChecked(claims, verdicts, refs);
    ctx.log("first pass", { claims: claims.length, problems: checked.filter((c) => c.verdict !== "supported").length });

    const problems = checked.filter((c) => c.verdict !== "supported");
    let blocks: ArticleBody = version.blocks;
    if (problems.length > 0) {
      const blockIds = [...new Set(problems.map((p) => p.blockId))];
      const targets = blocks.filter((b) => blockIds.includes(b.id) && isEditable(b));
      const prompt = await ctx.prompt("fact_fix");
      const fix = await ctx.llm.generateStructured({
        model: prompt.model,
        effort: prompt.effort,
        system: prompt.system,
        operation: "fact_fix",
        maxTokens: 16_000,
        schema: fixSchema,
        prompt: [
          `Blocks to repair (JSON):\n${JSON.stringify(targets.map((b) => ({ id: b.id, type: b.type, lines: blockToLines(b as never, refs) })))}`,
          `Problems:\n${problems
            .map(
              (p) =>
                `- [${p.blockId}] ${p.verdict}: "${p.text}" — ${p.note ?? ""}${p.sourceIds.length && p.verdict === "uncited" ? ` (supporting refs: ${p.sourceIds.map(refs.ref).join(", ")})` : ""}`,
            )
            .join("\n")}`,
          `Evidence:\n${problems
            .flatMap((p) =>
              (evidence.get(p.id) ?? []).map(
                (h) => `<evidence source="${refs.ref(h.sourceId)}">${bestWindow(h.text, p.text, 1400)}</evidence>`,
              ),
            )
            .filter((v, i, all) => all.indexOf(v) === i)
            .join("\n")}`,
        ].join("\n\n"),
      });
      const fixedIds = new Set<string>();
      blocks = blocks.map((b) => {
        const edit = fix.data.blocks.find((e) => e.id === b.id);
        if (!edit || !isEditable(b)) return b;
        const next = applyLines(b, edit.lines, refs);
        if (!next) return b;
        fixedIds.add(b.id);
        return next;
      });
      // Re-verify only the repaired blocks.
      const recheck = extractClaims(blocks.filter((b) => fixedIds.has(b.id)));
      const recheckEvidence = await gatherEvidence(ctx, article.productId, recheck);
      const recheckVerdicts = await verifyClaims(ctx, recheck, recheckEvidence, refs);
      checked = [
        ...checked.filter((c) => !fixedIds.has(c.blockId)),
        ...toChecked(recheck, recheckVerdicts, refs, fixedIds),
      ];
      ctx.log("repair pass", {
        repairedBlocks: fixedIds.size,
        remaining: checked.filter((c) => c.verdict !== "supported").length,
      });
    }

    const factCheck = buildReport(checked);
    const saved = await addArticleVersion(ctx.db, article.id, {
      blocks,
      seo: version.seo,
      overallScore: version.overallScore,
      factCheck,
      promptVersions: { ...version.promptVersions, fact_check: (await ctx.prompt("fact_check")).version },
      jobId: ctx.jobId,
      changeNote: `Fact-check: ${factCheck.supported}/${factCheck.claims.length} supported, ${factCheck.fixedCount} repaired`,
    });
    return {
      output: {
        versionId: saved.id,
        claims: factCheck.claims.length,
        supported: factCheck.supported,
        unsupported: factCheck.unsupported,
        outdated: factCheck.outdated,
        uncited: factCheck.uncited,
        fixed: factCheck.fixedCount,
      },
    };
  },
});
