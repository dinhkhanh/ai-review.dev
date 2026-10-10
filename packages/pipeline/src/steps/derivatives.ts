import {
  inlineText,
  parseInline,
  seoBriefSchema,
  slugify,
  type ArticleBody,
  type Block,
  type SeoBrief,
} from "@repo/content";
import {
  addArticleVersion,
  createArticle,
  ensureGoSlug,
  findDerivativeArticle,
  getDefaultAuthor,
  getProduct,
  latestFactSheet,
  listCompetitors,
  listMedia,
  listResearchedProducts,
  listSourcesForProducts,
  liveReviewsForProducts,
  searchChunks,
  setJobLinks,
  sourceRefs,
  updateArticleMeta,
  type ChunkHit,
} from "@repo/core";
import { categories, eq } from "@repo/db";
import { z } from "zod";
import { pricingTableFromFactSheet } from "../article-builder";
import { defineStep, type StepContext } from "../step";

export const DERIVATIVE_KINDS = ["comparison", "alternatives", "best_of"] as const;
export type DerivativeKind = (typeof DERIVATIVE_KINDS)[number];

/** Intake for comparison / alternatives / best-of jobs (FR-CON-8, FR-INT-5 presets). */
export const derivativeInputSchema = z.object({
  kind: z.enum(DERIVATIVE_KINDS),
  productIds: z.array(z.uuid()).max(12).default([]),
  /** The product the alternatives are for. */
  referenceProductId: z.uuid().nullable().default(null),
  categorySlug: z.string().nullable().default(null),
  angle: z.string().max(300).nullable().default(null),
  keywords: z.array(z.string()).default([]),
});
export type DerivativeInput = z.infer<typeof derivativeInputSchema>;

const LIMITS: Record<DerivativeKind, { min: number; max: number }> = {
  comparison: { min: 2, max: 3 },
  alternatives: { min: 3, max: 9 },
  best_of: { min: 3, max: 10 },
};

/**
 * derivative_prepare: picks the products (alternatives default to the reference's researched
 * competitors, best-of lists to the category's researched products) and checks every one has a
 * fact sheet. Missing research fails the job with the names to research first.
 */
export const derivativePrepareStep = defineStep({
  name: "derivative_prepare",
  input: derivativeInputSchema,
  output: z.object({
    kind: z.enum(DERIVATIVE_KINDS),
    productIds: z.array(z.string()),
    referenceProductId: z.string().nullable(),
    categoryId: z.string().nullable(),
  }),
  async run(ctx, input) {
    const [category] = input.categorySlug
      ? await ctx.db.select().from(categories).where(eq(categories.slug, input.categorySlug)).limit(1)
      : [];
    let ids = [...new Set(input.productIds)];
    if (input.kind === "alternatives") {
      if (!input.referenceProductId) throw new Error("Alternatives need a reference product");
      ids = ids.filter((id) => id !== input.referenceProductId);
      if (ids.length === 0) {
        const competitorIds = (await listCompetitors(ctx.db, input.referenceProductId)).map((c) => c.productId);
        const researched = await listResearchedProducts(ctx.db, { ids: competitorIds });
        ids = competitorIds.filter((id) => researched.some((r) => r.id === id));
      }
      ids = [input.referenceProductId, ...ids];
    }
    if (input.kind === "best_of" && ids.length === 0) {
      if (!category) throw new Error("A best-of list needs products or a category");
      const researched = await listResearchedProducts(ctx.db, { categoryId: category.id });
      const reviews = await liveReviewsForProducts(
        ctx.db,
        researched.map((r) => r.id),
      );
      const score = (id: string) => reviews.find((r) => r.productId === id)?.score ?? 0;
      ids = researched
        .filter((r) => r.status !== "discontinued")
        .map((r) => r.id)
        .sort((a, b) => score(b) - score(a));
    }
    const limit = LIMITS[input.kind];
    ids = ids.slice(0, limit.max);
    const researched = await listResearchedProducts(ctx.db, { ids });
    const missing = ids.filter((id) => !researched.some((r) => r.id === id));
    if (missing.length) {
      const names = await Promise.all(missing.map(async (id) => (await getProduct(ctx.db, id))?.name ?? id));
      throw new Error(`Research these products first (no fact sheet yet): ${names.join(", ")}`);
    }
    if (ids.length < limit.min) {
      throw new Error(
        `A ${input.kind.replace("_", "-")} needs at least ${limit.min} researched products (have ${ids.length})`,
      );
    }
    const categoryId =
      category?.id ??
      (input.kind === "alternatives" ? (researched.find((r) => r.id === ids[0])?.categoryId ?? null) : null);
    ctx.log("products selected", { kind: input.kind, products: ids.length });
    return {
      output: { kind: input.kind, productIds: ids, referenceProductId: input.referenceProductId, categoryId },
    };
  },
});

type Prepared = z.infer<typeof derivativePrepareStep.output>;

/** One compact line per product for prompts: P-ref, name, tagline, pricing, features, our score. */
async function productSummaries(ctx: StepContext, ids: string[]) {
  const reviews = await liveReviewsForProducts(ctx.db, ids);
  return Promise.all(
    ids.map(async (id, i) => {
      const product = (await getProduct(ctx.db, id))!;
      const sheet = await latestFactSheet(ctx.db, id);
      const review = reviews.find((r) => r.productId === id);
      const tiers = sheet?.data.pricing?.tiers.value ?? [];
      return {
        ref: `P${i + 1}`,
        id,
        product,
        sheet,
        review,
        line: [
          `P${i + 1}: ${product.name} (${product.websiteUrl})`,
          product.tagline ? `— ${product.tagline}` : "",
          tiers.length
            ? `Pricing: ${tiers.map((t) => `${t.name} ${t.price === null ? "custom" : `${t.price} ${t.currency}/${t.period}`}`).join("; ")}`
            : "",
          sheet?.data.features.length
            ? `Features: ${sheet.data.features
                .slice(0, 8)
                .map((f) => f.value)
                .join(", ")}`
            : "",
          review?.score != null ? `Our review score: ${review.score}/10` : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }),
  );
}

/** derivative_brief (FR-CON-1 for derivatives): keywords, title, slug, outline, FAQ, internal links. */
export const derivativeBriefStep = defineStep({
  name: "derivative_brief",
  input: z.object({ angle: z.string().nullable(), keywords: z.array(z.string()) }),
  output: z.object({ brief: seoBriefSchema }),
  async run(ctx, input) {
    const prepared = await ctx.previous<Prepared>("derivative_prepare");
    if (!prepared) throw new Error("derivative_prepare output missing");
    const summaries = await productSummaries(ctx, prepared.productIds);
    const [category] = prepared.categoryId
      ? await ctx.db.select().from(categories).where(eq(categories.id, prepared.categoryId)).limit(1)
      : [];
    const prompt = await ctx.prompt("derivative_brief");
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "derivative_brief",
      maxTokens: 8_000,
      schema: seoBriefSchema,
      prompt: [
        `Article type: ${prepared.kind}. Today is ${new Date().toISOString().slice(0, 10)}.`,
        prepared.kind === "alternatives" ? `Reference product: ${summaries[0]!.product.name}` : "",
        category ? `Category: ${category.name}` : "",
        input.angle ? `Angle: ${input.angle}` : "",
        input.keywords.length ? `Target keywords from the editor: ${input.keywords.join(", ")}` : "",
        `Products:\n${summaries.map((s) => s.line).join("\n")}`,
        `Existing reviews you may link to (articleId | title):\n${
          summaries
            .filter((s) => s.review)
            .map((s) => `${s.review!.articleId} | ${s.review!.title}`)
            .join("\n") || "(none)"
        }`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const allowed = new Set(summaries.flatMap((s) => (s.review ? [s.review.articleId] : [])));
    const brief: SeoBrief = {
      ...res.data,
      intent: prepared.kind,
      slug: slugify(res.data.slug) || slugify(res.data.title),
      angle: input.angle ?? res.data.angle,
      internalLinks: res.data.internalLinks.filter((l) => allowed.has(l.articleId)),
    };
    // Every reviewed product gets a link even if the model forgot it.
    for (const s of summaries)
      if (s.review && !brief.internalLinks.some((l) => l.articleId === s.review!.articleId))
        brief.internalLinks.push({ articleId: s.review.articleId, anchor: `${s.product.name} review` });
    return { output: { brief }, model: res.model, promptVersion: prompt.version };
  },
});

/** Model-facing draft (flat; strings use the inline syntax with [^S#] citations). */
export const derivativeDraftSchema = z.object({
  title: z.string(),
  metaDescription: z.string(),
  verdictSummary: z.string(),
  intro: z.array(z.string()),
  entries: z.array(
    z.object({
      product: z.string(),
      bestFor: z.string(),
      paragraphs: z.array(z.string()),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
      pricingNote: z.string(),
    }),
  ),
  sections: z.array(z.object({ heading: z.string(), paragraphs: z.array(z.string()), bullets: z.array(z.string()) })),
  comparisonRows: z.array(z.object({ label: z.string(), values: z.array(z.string()) })),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  finalVerdict: z.array(z.string()),
  ctaLabel: z.string(),
});
export type DerivativeDraft = z.infer<typeof derivativeDraftSchema>;

export interface DerivativeBuildContext {
  kind: DerivativeKind;
  refToId: (ref: string) => string | null;
  /** Products in prompt order (P1 = index 0). */
  products: Array<{ id: string; name: string; goSlug: string }>;
  /** Pricing table per product id, built from its fact sheet. */
  pricingTables: Map<string, Block | null>;
  /** Home screenshot per product id for list entries. */
  screenshots: Map<string, string>;
}

const plain = (md: string) => inlineText(parseInline(md, { resolveCitation: () => null })).trim();

/**
 * Assembles a comparison or list article from the draft plus deterministic blocks: comparison
 * table, per-product CTAs (placement `pick_<n>`), pricing tables and screenshots from research,
 * FAQ and sources. Products the model referenced but that do not exist are dropped.
 */
export function buildDerivativeBlocks(draft: DerivativeDraft, ctx: DerivativeBuildContext): ArticleBody {
  const opts = { resolveCitation: ctx.refToId };
  const label = draft.ctaLabel.trim().slice(0, 60) || "Visit website";
  const para = (id: string, md: string): Block => ({ id, type: "paragraph", children: parseInline(md, opts) });
  const byRef = (ref: string) => {
    const n = Number(/^P?(\d+)$/i.exec(ref.trim())?.[1] ?? NaN);
    return Number.isInteger(n) ? ctx.products[n - 1] : undefined;
  };
  // For alternatives the reference product (P1) is the subject, not an entry.
  const entries = draft.entries
    .map((e) => ({ e, p: byRef(e.product) }))
    .filter((x): x is { e: DerivativeDraft["entries"][number]; p: DerivativeBuildContext["products"][number] } => !!x.p)
    .filter((x, i, all) => all.findIndex((y) => y.p.id === x.p.id) === i)
    .filter((x) => !(ctx.kind === "alternatives" && x.p.id === ctx.products[0]!.id));

  const blocks: Block[] = [
    { id: "verdict-h", type: "heading", level: 2, text: "The short answer" },
    para("verdict-0", draft.verdictSummary),
    ...draft.intro.filter((p) => p.trim()).map((p, i) => para(`intro-${i}`, p)),
  ];
  const rows = draft.comparisonRows
    .map((r) => ({ label: plain(r.label), values: ctx.products.map((_, i) => plain(r.values[i] ?? "—") || "—") }))
    .filter((r) => r.label);
  const table: Block[] =
    rows.length && ctx.products.length >= 2
      ? [
          { id: "comparison-h", type: "heading", level: 2, text: "At a glance" },
          { id: "comparison", type: "comparison_table", productIds: ctx.products.map((p) => p.id), rows },
        ]
      : [];

  const entryBlocks = entries.flatMap(({ e, p }, i): Block[] => {
    const n = i + 1;
    const heading = ctx.kind === "comparison" ? `Choose ${p.name} if…` : `${n}. ${p.name}`;
    const out: Block[] = [
      { id: `entry-${n}-h`, type: "heading", level: 2, text: heading },
      {
        id: `entry-${n}-best`,
        type: "callout",
        tone: "tip",
        children: parseInline(`**Best for:** ${e.bestFor}`, opts),
      },
      ...e.paragraphs.filter((x) => x.trim()).map((x, k) => para(`entry-${n}-p${k}`, x)),
    ];
    const shot = ctx.screenshots.get(p.id);
    if (shot && ctx.kind !== "comparison") out.push({ id: `entry-${n}-shot`, type: "image", assetId: shot });
    if (e.pros.length || e.cons.length) {
      out.push({
        id: `entry-${n}-pc`,
        type: "pros_cons",
        pros: e.pros.map(plain).filter(Boolean),
        cons: e.cons.map(plain).filter(Boolean),
      });
    }
    if (e.pricingNote.trim()) out.push(para(`entry-${n}-price`, e.pricingNote));
    const pricing = ctx.kind === "comparison" ? ctx.pricingTables.get(p.id) : null;
    if (pricing) out.push({ ...pricing, id: `entry-${n}-pricing` });
    out.push({
      id: `cta-entry-${n}`,
      type: "cta",
      goSlug: p.goSlug,
      placement: `pick_${n}`,
      label: `${label}: ${p.name}`.slice(0, 80),
    });
    return out;
  });

  const sectionBlocks = draft.sections.flatMap((s, i): Block[] => {
    const out: Block[] = [{ id: `part-${i}-h`, type: "heading", level: 2, text: plain(s.heading) }];
    s.paragraphs.filter((x) => x.trim()).forEach((x, k) => out.push(para(`part-${i}-p${k}`, x)));
    const bullets = s.bullets.filter((b) => b.trim());
    if (bullets.length)
      out.push({ id: `part-${i}-list`, type: "list", ordered: false, items: bullets.map((b) => parseInline(b, opts)) });
    return out;
  });

  // Comparisons lead with the head-to-head sections; lists lead with the ranked entries.
  if (ctx.kind === "comparison") blocks.push(...table, ...sectionBlocks, ...entryBlocks);
  else blocks.push(...table, ...entryBlocks, ...sectionBlocks);

  const faq = draft.faq.filter((f) => f.question.trim() && f.answer.trim());
  if (faq.length) {
    blocks.push({ id: "faq-h", type: "heading", level: 2, text: "FAQ" });
    blocks.push({
      id: "faq",
      type: "faq",
      items: faq.map((f) => ({ question: plain(f.question), answer: parseInline(f.answer, opts) })),
    });
  }
  blocks.push({ id: "final-h", type: "heading", level: 2, text: "Verdict" });
  draft.finalVerdict.filter((p) => p.trim()).forEach((p, i) => blocks.push(para(`final-${i}`, p)));
  blocks.push({ id: "sources", type: "sources" });
  return blocks;
}

/** Retrieval per product so every product gets evidence in the prompt (FR-RES-3). */
async function retrieveForProducts(ctx: StepContext, products: Array<{ id: string; name: string }>, brief: SeoBrief) {
  const hits: ChunkHit[] = [];
  const perProduct = Math.max(4, Math.floor(36 / products.length));
  for (const p of products) {
    const queries = [`${p.name} pricing plans`, `${p.name} features limitations`, `${p.name} ${brief.primaryKeyword}`];
    const vectors = ctx.embedder ? await ctx.embedder.embed(queries, { inputType: "query" }).catch(() => null) : null;
    const seen = new Set<string>();
    for (let i = 0; i < queries.length && seen.size < perProduct; i++) {
      for (const h of await searchChunks(ctx.db, p.id, {
        query: queries[i]!,
        embedding: vectors?.[i] ?? null,
        limit: 4,
      })) {
        if (!seen.has(h.id) && seen.size < perProduct) {
          seen.add(h.id);
          hits.push(h);
        }
      }
    }
  }
  return hits;
}

/** derivative_write (FR-CON-8): the comparison or list article as blocks with citations, as a new version. */
export const derivativeWriteStep = defineStep({
  name: "derivative_write",
  input: z.object({}),
  output: z.object({ articleId: z.string(), versionId: z.string(), version: z.number() }),
  async run(ctx) {
    const prepared = await ctx.previous<Prepared>("derivative_prepare");
    const briefOut = await ctx.previous<{ brief: SeoBrief }>("derivative_brief");
    if (!prepared || !briefOut) throw new Error("derivative_prepare/derivative_brief output missing");
    const brief = briefOut.brief;
    const summaries = await productSummaries(ctx, prepared.productIds);
    const sources = await listSourcesForProducts(ctx.db, prepared.productIds);
    const refs = sourceRefs(sources);
    const chunks = await retrieveForProducts(
      ctx,
      summaries.map((s) => ({ id: s.id, name: s.product.name })),
      brief,
    );
    const sheets = summaries.map((s) => {
      const data = s.sheet
        ? JSON.stringify(s.sheet.data, (k, v) =>
            k === "citations" && Array.isArray(v) ? v.map((c: { sourceId: string }) => refs.ref(c.sourceId)) : v,
          )
        : "{}";
      return `<product ref="${s.ref}" name="${s.product.name}">\n${data}\n</product>`;
    });

    const prompt = await ctx.prompt("derivative_write");
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "derivative_write",
      maxTokens: 48_000,
      schema: derivativeDraftSchema,
      prompt: [
        `Write a ${prepared.kind.replace("_", "-")} article. Today is ${new Date().toISOString().slice(0, 10)}.`,
        prepared.kind === "alternatives"
          ? `Reference product (the one readers want alternatives to): P1 ${summaries[0]!.product.name}. Do not list it as an entry.`
          : "",
        `SEO brief:\n${JSON.stringify(brief)}`,
        `Products (comparison table values must follow this order):\n${summaries.map((s) => s.line).join("\n")}`,
        `Sources (ref | product | kind | title | url):\n${sources
          .map(
            (s) =>
              `${refs.ref(s.id)} | ${summaries.find((p) => p.id === s.productId)?.ref ?? ""} | ${s.kind} | ${s.title ?? ""} | ${s.url}`,
          )
          .join("\n")}`,
        `Fact sheets (citations are source refs):\n${sheets.join("\n")}`,
        `Research excerpts:\n${chunks.map((c) => `<excerpt source="${refs.ref(c.sourceId)}">\n${c.text}\n</excerpt>`).join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const goSlugs = await Promise.all(summaries.map((s) => ensureGoSlug(ctx.db, s.product)));
    const screenshots = new Map<string, string>();
    for (const s of summaries) {
      const shot = (await listMedia(ctx.db, { productId: s.id })).find((m) => m.role === "screenshot:home:desktop");
      if (shot) screenshots.set(s.id, shot.id);
    }
    const blocks = buildDerivativeBlocks(res.data, {
      kind: prepared.kind,
      refToId: refs.id,
      products: summaries.map((s, i) => ({ id: s.id, name: s.product.name, goSlug: goSlugs[i]!.slug })),
      pricingTables: new Map(
        summaries.map((s) => [
          s.id,
          pricingTableFromFactSheet(s.sheet?.data ?? null, s.sheet?.createdAt ?? new Date()),
        ]),
      ),
      screenshots,
    });

    const author = await getDefaultAuthor(ctx.db);
    let article = await findDerivativeArticle(ctx.db, {
      type: prepared.kind,
      productIds: prepared.productIds,
      referenceProductId: prepared.referenceProductId,
      slug: brief.slug,
    });
    if (!article) {
      article = await createArticle(ctx.db, {
        type: prepared.kind,
        productId: prepared.kind === "alternatives" ? prepared.referenceProductId : null,
        productIds: prepared.productIds,
        categoryId: prepared.categoryId,
        title: res.data.title,
        slug: brief.slug,
        authorId: author?.id ?? null,
        brief,
      });
    } else {
      article = await updateArticleMeta(ctx.db, article.id, {
        brief,
        ...(article.publishedVersionId ? {} : { title: res.data.title }),
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
      overallScore: null,
      promptVersions: { derivative_write: prompt.version },
      jobId: ctx.jobId,
      changeNote: `Generated by the ${prepared.kind.replace("_", "-")} writer`,
    });
    await setJobLinks(ctx.db, ctx.jobId, { articleId: article.id });
    ctx.log("article written", { articleId: article.id, version: version.version, blocks: blocks.length });
    return {
      output: { articleId: article.id, versionId: version.id, version: version.version },
      model: res.model,
      promptVersion: prompt.version,
    };
  },
});
