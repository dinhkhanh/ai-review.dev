import { articleText, readingGrade } from "@repo/content";
import { addArticleVersion, getArticle, getCurrentVersion, getSetting, listSources, sourceRefs } from "@repo/core";
import { z } from "zod";
import { applyLines, blockToLines, citationSignature, isEditable } from "../article-lines";
import { findBannedPhrases } from "../qa";
import { defineStep } from "../step";

export const styleSchema = z.object({ blocks: z.array(z.object({ id: z.string(), lines: z.array(z.string()) })) });

/**
 * style_pass (FR-CON-6): deterministic checks first (banned phrases, reading grade), then a copy
 * edit of prose blocks. An edited line is accepted only if its citation markers are unchanged, so
 * the style pass can never detach a claim from its source.
 */
export const stylePassStep = defineStep({
  name: "style_pass",
  input: z.object({ articleId: z.uuid() }),
  output: z.object({
    versionId: z.string(),
    editedBlocks: z.number(),
    rejectedLines: z.number(),
    readingGradeBefore: z.number(),
    readingGradeAfter: z.number(),
    bannedBefore: z.array(z.string()),
    bannedAfter: z.array(z.string()),
  }),
  async run(ctx, input) {
    const article = await getArticle(ctx.db, input.articleId);
    const version = await getCurrentVersion(ctx.db, input.articleId);
    if (!article?.productId || !version) throw new Error("Article or version not found");
    const refs = sourceRefs(await listSources(ctx.db, article.productId));
    const banned = (await getSetting(ctx.db, "editorial.bannedPhrases")) ?? [];
    const before = articleText(version.blocks);
    const bannedBefore = findBannedPhrases(before, banned);

    const editable = version.blocks.filter((b) => isEditable(b) && b.type !== "rubric");
    const prompt = await ctx.prompt("style_pass");
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "style_pass",
      maxTokens: 32_000,
      schema: styleSchema,
      prompt: [
        bannedBefore.length ? `Banned phrases found: ${bannedBefore.join(", ")}` : null,
        `Current reading grade: ${readingGrade(before)} (target 8–10).`,
        `Blocks (JSON):\n${JSON.stringify(editable.map((b) => ({ id: b.id, type: b.type, lines: blockToLines(b as never, refs) })))}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    let edited = 0;
    let rejected = 0;
    const blocks = version.blocks.map((b) => {
      const edit = res.data.blocks.find((e) => e.id === b.id);
      if (!edit || !isEditable(b) || b.type === "rubric") return b;
      const original = blockToLines(b, refs);
      if (edit.lines.length !== original.length) {
        rejected += original.length;
        return b;
      }
      const lines = edit.lines.map((line, i) => {
        if (citationSignature(line) === citationSignature(original[i]!)) return line;
        rejected++;
        return original[i]!;
      });
      if (lines.every((l, i) => l === original[i])) return b;
      const next = applyLines(b, lines, refs);
      if (!next) return b;
      edited++;
      return next;
    });
    const after = articleText(blocks);
    const saved = await addArticleVersion(ctx.db, article.id, {
      blocks,
      seo: version.seo,
      overallScore: version.overallScore,
      factCheck: version.factCheck,
      promptVersions: { ...version.promptVersions, style_pass: prompt.version },
      jobId: ctx.jobId,
      changeNote: `Style pass: ${edited} blocks edited`,
    });
    return {
      output: {
        versionId: saved.id,
        editedBlocks: edited,
        rejectedLines: rejected,
        readingGradeBefore: readingGrade(before),
        readingGradeAfter: readingGrade(after),
        bannedBefore,
        bannedAfter: findBannedPhrases(after, banned),
      },
      model: res.model,
      effort: prompt.effort,
      promptVersion: prompt.version,
    };
  },
});
