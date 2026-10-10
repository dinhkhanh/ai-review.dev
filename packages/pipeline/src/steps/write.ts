import { DEFAULT_RUBRIC, type SeoBrief } from "@repo/content";
import {
  addArticleVersion,
  createArticle,
  findArticleForProduct,
  getDefaultAuthor,
  getGoSlugForProduct,
  getProduct,
  latestFactSheet,
  listCompetitors,
  listMedia,
  listSources,
  searchChunks,
  setJobLinks,
  sourceRefs,
  updateArticleMeta,
  updateMediaAlt,
  type ChunkHit,
} from "@repo/core";
import { categories, eq } from "@repo/db";
import { z } from "zod";
import { articleDraftSchema, buildReviewBlocks, screenshotAltText } from "../article-builder";
import { defineStep, type StepContext } from "../step";

/** Retrieves supporting chunks for each outline section (FR-RES-3), deduplicated and capped. */
async function retrieveForBrief(ctx: StepContext, productId: string, brief: SeoBrief, productName: string) {
  const queries = [
    `${productName} pricing plans`,
    `${productName} features`,
    ...brief.outline.map((o) => `${productName} ${o.heading} ${o.points.join(" ")}`.slice(0, 300)),
    ...brief.faqQuestions.slice(0, 4),
  ];
  const vectors = ctx.embedder ? await ctx.embedder.embed(queries, { inputType: "query" }).catch(() => null) : null;
  const seen = new Map<string, ChunkHit>();
  for (let i = 0; i < queries.length; i++) {
    const hits = await searchChunks(ctx.db, productId, {
      query: queries[i]!,
      embedding: vectors?.[i] ?? null,
      limit: 4,
    });
    for (const h of hits) if (!seen.has(h.id)) seen.set(h.id, h);
    if (seen.size >= 32) break;
  }
  return [...seen.values()].slice(0, 32);
}

/** write (FR-CON-2/3/4): the full review as structured blocks with citations and rubric scores. */
export const writeStep = defineStep({
  name: "write",
  input: z.object({ productId: z.uuid() }),
  output: z.object({ articleId: z.string(), versionId: z.string(), version: z.number(), overallScore: z.number() }),
  async run(ctx, input) {
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);
    const briefOut = await ctx.previous<{ brief: SeoBrief }>("seo_brief");
    if (!briefOut) throw new Error("seo_brief output missing");
    const brief = briefOut.brief;
    const [sheet, sources, competitors, media, go, author] = await Promise.all([
      latestFactSheet(ctx.db, product.id),
      listSources(ctx.db, product.id),
      listCompetitors(ctx.db, product.id),
      listMedia(ctx.db, { productId: product.id }),
      getGoSlugForProduct(ctx.db, product.id),
      getDefaultAuthor(ctx.db),
    ]);
    if (!sheet) throw new Error("No fact sheet; run research first");
    if (!go) throw new Error("Product has no go-slug");
    const [category] = product.categoryId
      ? await ctx.db.select().from(categories).where(eq(categories.id, product.categoryId)).limit(1)
      : [];
    const rubric = category?.rubric?.length ? category.rubric : DEFAULT_RUBRIC;
    const refs = sourceRefs(sources);
    const chunks = await retrieveForBrief(ctx, product.id, brief, product.name);
    // Latest screenshot per role.
    const screenshots = [
      ...new Map(
        media
          .filter((m) => m.kind === "screenshot" && m.role)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((m) => [m.role!, { role: m.role!, assetId: m.id, capturedAt: m.capturedAt ?? m.createdAt }]),
      ).values(),
    ];
    const comparisonCompetitors = competitors.slice(0, 3);

    const prompt = await ctx.prompt("write");
    const factSheetForPrompt = JSON.stringify(sheet.data, (k, v) =>
      k === "citations" && Array.isArray(v) ? v.map((c: { sourceId: string }) => refs.ref(c.sourceId)) : v,
    );
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "write",
      maxTokens: 48_000,
      schema: articleDraftSchema,
      prompt: [
        `Write the review of ${product.name} (${product.websiteUrl}). Today is ${new Date().toISOString().slice(0, 10)}.`,
        `SEO brief:\n${JSON.stringify(brief)}`,
        `Rubric dimensions (key: label, weight):\n${rubric.map((d) => `${d.key}: ${d.label} (${d.weight})`).join("\n")}`,
        `Competitors for the comparison, in this order after ${product.name}:\n${
          comparisonCompetitors.map((c, i) => `${i + 1}. ${c.name} — ${c.note ?? ""}`).join("\n") || "(none)"
        }`,
        `Other alternatives: ${
          competitors
            .slice(3)
            .map((c) => `${c.name} — ${c.note ?? ""}`)
            .join("; ") || "(none)"
        }`,
        `Screenshots we captured (role, date):\n${
          screenshots.map((s) => `${s.role} — ${s.capturedAt.toISOString().slice(0, 10)}`).join("\n") || "(none)"
        }`,
        `Sources (ref, kind, title, url):\n${sources.map((s) => `${refs.ref(s.id)} | ${s.kind} | ${s.title ?? ""} | ${s.url}`).join("\n")}`,
        `Fact sheet (citations are source refs):\n${factSheetForPrompt}`,
        `Research excerpts:\n${chunks.map((c) => `<excerpt source="${refs.ref(c.sourceId)}">\n${c.text}\n</excerpt>`).join("\n")}`,
      ].join("\n\n"),
    });

    const { blocks, overallScore } = buildReviewBlocks(res.data, {
      refToId: refs.id,
      goSlug: go.slug,
      rubric,
      comparisonProductIds: [product.id, ...comparisonCompetitors.map((c) => c.productId)],
      factSheet: sheet.data,
      factSheetAt: sheet.createdAt,
      screenshots,
    });
    for (const [assetId, alt] of screenshotAltText(res.data, screenshots)) await updateMediaAlt(ctx.db, assetId, alt);

    let article = await findArticleForProduct(ctx.db, product.id, "review");
    if (!article) {
      article = await createArticle(ctx.db, {
        type: "review",
        productId: product.id,
        title: res.data.title,
        slug: brief.slug,
        authorId: author?.id ?? null,
        brief,
      });
    } else {
      article = await updateArticleMeta(ctx.db, article.id, {
        brief,
        ...(article.status === "published" || article.publishedVersionId ? {} : { title: res.data.title }),
      });
    }
    const version = await addArticleVersion(ctx.db, article.id, {
      blocks,
      seo: {
        title: res.data.title.slice(0, 70),
        metaDescription: res.data.metaDescription.slice(0, 170),
        primaryKeyword: brief.primaryKeyword,
        secondaryKeywords: brief.secondaryKeywords,
        intent: brief.intent,
        internalLinks: brief.internalLinks,
      },
      overallScore,
      promptVersions: { write: prompt.version },
      jobId: ctx.jobId,
      changeNote: "Generated by the write step",
    });
    await setJobLinks(ctx.db, ctx.jobId, { articleId: article.id });
    ctx.log("article written", {
      articleId: article.id,
      version: version.version,
      blocks: blocks.length,
      overallScore,
    });
    return {
      output: { articleId: article.id, versionId: version.id, version: version.version, overallScore },
      model: res.model,
      effort: prompt.effort,
      promptVersion: prompt.version,
    };
  },
});
