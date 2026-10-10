import type { GenerateOptions, Llm } from "@repo/ai";
import type { Block } from "@repo/content";
import {
  addArticleVersion,
  afterPublish,
  createArticle,
  createTranslationJob,
  findOrCreateProduct,
  findTranslation,
  getCurrentVersion,
  getJob,
  pathsForArticle,
  publishArticle,
  queueAutoTranslations,
  setSetting,
  setVersionQa,
  translationCoverage,
  translationGroup,
  upsertSource,
} from "@repo/core";
import { articles, categories, eq, products } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { computeQaScorecard } from "../qa";
import { runReviewJob, type StepServices } from "../index";
import { changedUnits, planRetranslation } from "./diff";
import { englishPriceNumbers, targetNumbers, translationChecks } from "./qa";
import { applySegments, extractSegments, parseWithTokens, repairCitations, segmentProblems } from "./segments";
import { chunkSegments, clampText } from "./steps";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

const sampleBlocks = (plusPrice = 12): Block[] => [
  { id: "sec-overview-h", type: "heading", level: 2, text: "What Acme is" },
  {
    id: "sec-overview-p1",
    type: "paragraph",
    children: [
      { text: "Acme is a ", marks: [] },
      { text: "fast", marks: [{ type: "bold" }] },
      { text: " tracker for small teams.", marks: [] },
      { text: "", marks: [{ type: "citation", citation: { sourceId: S1, quote: "project tracker" } }] },
      { text: " Start with the ", marks: [] },
      { text: "free plan", marks: [{ type: "golink", slug: "acme", placement: "inline" }] },
      { text: " or read the ", marks: [] },
      { text: "docs", marks: [{ type: "link", href: "https://acme.dev/docs" }] },
      { text: ".", marks: [] },
    ],
  },
  { id: "sec-pricing-h", type: "heading", level: 2, text: "Pricing" },
  {
    id: "sec-pricing-p1",
    type: "paragraph",
    children: [
      {
        text: `Plus costs $${plusPrice} per user per month, and Business costs $1,200.50 a year with 20% off.`,
        marks: [],
      },
      { text: "", marks: [{ type: "citation", citation: { sourceId: S2 } }] },
    ],
  },
  {
    id: "pricing",
    type: "pricing_table",
    verifiedAt: "2026-10-01T00:00:00.000Z",
    tiers: [
      {
        name: "Plus",
        price: plusPrice,
        currency: "USD",
        period: "month",
        highlights: ["Unlimited projects"],
        citations: [{ sourceId: S2 }],
      },
    ],
  },
  { id: "pc", type: "pros_cons", pros: ["Very fast interface"], cons: ["No time tracking"] },
  {
    id: "verdict",
    type: "verdict",
    score: 8.1,
    summary: "A quick tracker that small teams will like.",
    bestFor: ["Startups"],
    notFor: ["Agencies that bill hours"],
  },
  { id: "cta-main", type: "cta", goSlug: "acme", placement: "verdict", label: "Try Acme free" },
  { id: "sources", type: "sources" },
];

/** Fake "German": prefixes text, keeps markup, writes prices German-style. */
const fakeGerman = (_key: string, text: string) =>
  `DE ${text.replace(/\$1,200\.50/g, "1.200,50 $").replace(/\$(\d+)\b/g, "$1 $")}`;

describe("translation segments", () => {
  it("round-trips structure and maps citation tokens back to the exact citation", () => {
    const blocks = sampleBlocks();
    const set = extractSegments(blocks);
    const p1 = set.segments.find((s) => s.key === "sec-overview-p1|children")!;
    expect(p1.text).toBe(
      "Acme is a **fast** tracker for small teams.[^C1] Start with the [free plan](go:acme#inline) or read the [docs](https://acme.dev/docs).",
    );
    expect(set.segments.some((s) => s.blockId === "sources")).toBe(false);
    const same = applySegments(blocks, set, new Map(set.segments.map((s) => [s.key, s.text])));
    expect(same).toEqual(blocks);

    const de = applySegments(blocks, set, new Map(set.segments.map((s) => [s.key, fakeGerman(s.key, s.text)])));
    expect(de.map((b) => [b.id, b.type])).toEqual(blocks.map((b) => [b.id, b.type]));
    const para = de.find((b) => b.id === "sec-overview-p1");
    expect(para?.type === "paragraph" && para.children.find((c) => c.marks[0]?.type === "citation")?.marks[0]).toEqual({
      type: "citation",
      citation: { sourceId: S1, quote: "project tracker" },
    });
    const cta = de.find((b) => b.id === "cta-main");
    expect(cta).toMatchObject({ goSlug: "acme", placement: "verdict", label: "DE Try Acme free" });
  });

  it("drops unknown citation tokens and flags/repairs lost markers", () => {
    const set = extractSegments(sampleBlocks());
    expect(parseWithTokens("Hallo[^C99] Welt", set.citations)).toEqual([{ text: "Hallo Welt", marks: [] }]);
    const seg = set.segments.find((s) => s.key === "sec-overview-p1|children")!;
    const bad = "Acme ist ein schneller Tracker. Mehr in den [Dokumenten](https://acme.dev/other).";
    expect(segmentProblems(seg, bad)).toEqual([
      "missing citation markers [^C1]",
      "link targets must stay unchanged: go:acme#inline, https://acme.dev/docs",
    ]);
    expect(repairCitations(seg, bad)).toEqual({ text: `${bad}[^C1]`, repaired: 1 });
  });

  it("chunks without splitting a section", () => {
    const set = extractSegments(sampleBlocks());
    const chunks = chunkSegments(set.segments, 60);
    for (const chunk of chunks) {
      const sections = new Set(chunk.map((s) => s.blockId.match(/^sec-([a-z]+)-/)?.[1] ?? s.blockId));
      if (chunk.some((s) => s.blockId.startsWith("sec-pricing"))) expect([...sections]).toEqual(["pricing"]);
    }
    expect(chunks.flat()).toHaveLength(set.segments.length);
    expect(clampText("Notion Test 2026: Preise, Funktionen und unsere ehrliche Meinung im Überblick", 50)).toBe(
      "Notion Test 2026: Preise, Funktionen und unsere",
    );
  });
});

describe("translation QA", () => {
  it("parses English and German numbers", () => {
    expect(englishPriceNumbers("Plus costs $12 per user, Business $1,200.50, 20% off, 3 seats")).toEqual([
      12, 1200.5, 20,
    ]);
    expect([...targetNumbers("12 $ pro Nutzer, 1.200,50 $ im Jahr, 20 %")]).toEqual(
      expect.arrayContaining([12, 1200.5, 20]),
    );
  });

  it("passes a faithful translation and fails lost citations, CTAs and prices", () => {
    const source = sampleBlocks();
    const set = extractSegments(source);
    const good = applySegments(source, set, new Map(set.segments.map((s) => [s.key, fakeGerman(s.key, s.text)])));
    const qa = translationChecks(source, good, { locale: "de" });
    expect(qa.failed).toEqual([]);
    expect(qa.checks.find((c) => c.key === "translation_complete")?.passed).toBe(true);

    const broken = applySegments(
      source,
      set,
      new Map([
        ["sec-overview-p1|children", "Acme ist schnell."],
        ["sec-pricing-p1|children", "Plus kostet 15 $ pro Monat.[^C2]"],
      ]),
    ).filter((b) => b.id !== "cta-main");
    const bad = translationChecks(source, broken, { locale: "de" });
    expect(bad.failed).toEqual([
      "translation_citations",
      "translation_golinks",
      "translation_links",
      "translation_prices",
    ]);
    expect(bad.checks.find((c) => c.key === "translation_structure")?.passed).toBe(false);
    expect(bad.checks.find((c) => c.key === "translation_complete")?.passed).toBe(false);
  });

  it("flags German AI clichés", () => {
    const source = sampleBlocks();
    const set = extractSegments(source);
    const t = applySegments(
      source,
      set,
      new Map(
        set.segments.map((s) => [
          s.key,
          s.key === "verdict|summary" ? "Ein Gamechanger für nahtlose Teams." : fakeGerman(s.key, s.text),
        ]),
      ),
    );
    expect(
      translationChecks(source, t, { locale: "de" }).checks.find((c) => c.key === "banned_phrases_de"),
    ).toMatchObject({
      passed: false,
      detail: "gamechanger, nahtlos",
    });
  });
});

describe("section-level re-translation", () => {
  it("re-translates only changed sections and keeps editor edits elsewhere", () => {
    const oldSource = sampleBlocks(12);
    const newSource = sampleBlocks(15);
    expect([...changedUnits(oldSource, newSource)].sort()).toEqual(["pricing", "sec-pricing"]);

    const set = extractSegments(oldSource);
    const translation = applySegments(
      oldSource,
      set,
      new Map(set.segments.map((s) => [s.key, fakeGerman(s.key, s.text)])),
    );
    // Editor rewrote the overview heading and added a tip after it.
    const edited: Block[] = translation.flatMap((b) =>
      b.id === "sec-overview-h"
        ? [
            { ...b, text: "Was Acme ist (redigiert)" } as Block,
            { id: "tip-de", type: "callout", tone: "tip", children: [{ text: "Tipp", marks: [] }] } as Block,
          ]
        : [b],
    );
    const { plan, units } = planRetranslation(oldSource, newSource, edited);
    expect(units.sort()).toEqual(["pricing", "sec-pricing"]);
    expect(plan.filter((p) => p.kind === "source").map((p) => p.block.id)).toEqual([
      "sec-pricing-h",
      "sec-pricing-p1",
      "pricing",
    ]);
    expect(plan.map((p) => p.block.id)).toEqual([
      "sec-overview-h",
      "tip-de",
      "sec-overview-p1",
      "sec-pricing-h",
      "sec-pricing-p1",
      "pricing",
      "pc",
      "verdict",
      "cta-main",
      "sources",
    ]);
    expect(plan[0]!.block).toMatchObject({ text: "Was Acme ist (redigiert)" });
  });
});

// --- Pipeline with a fake model ---

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
});

const calls: Array<{ operation: string; keys: string[] }> = [];
/** Drops the citation marker of the pricing paragraph on the first attempt to exercise the retry. */
let dropMarkerOnce = true;

function fakeLlm(): Llm {
  const base = (opts: GenerateOptions) => ({
    text: "",
    model: opts.model,
    stopReason: "end_turn",
    fallbackUsed: false,
    cost: {
      costUsd: 0.02,
      inputTokens: 100,
      outputTokens: 80,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      models: [opts.model],
      unpricedModels: [],
    },
    raw: {} as never,
  });
  return {
    generate: async (opts) => base(opts),
    generateStructured: async <S extends z.ZodType>(opts: GenerateOptions & { schema: S }) => {
      const prompt = opts.prompt ?? "";
      if (opts.operation === "translate_catalog") {
        const items = JSON.parse(prompt.slice(prompt.indexOf("["))) as Array<{ key: string; text: string }>;
        calls.push({ operation: opts.operation, keys: items.map((i) => i.key) });
        return {
          ...base(opts),
          data: opts.schema.parse({ items: items.map((i) => ({ key: i.key, text: `DE ${i.text}` })) }),
        };
      }
      const json = prompt.slice(prompt.indexOf("[", prompt.indexOf("Segments (")));
      const segs = JSON.parse(json) as Array<{ key: string; text: string }>;
      calls.push({ operation: opts.operation, keys: segs.map((s) => s.key) });
      const out = segs.map((s) => {
        let text = fakeGerman(s.key, s.text);
        if (dropMarkerOnce && s.key === "sec-pricing-p1|children") {
          dropMarkerOnce = false;
          text = text.replace(/\[\^C\d+\]/g, "");
        }
        return { key: s.key, text };
      });
      return { ...base(opts), data: opts.schema.parse({ segments: out }) };
    },
  } as Llm;
}

function services(): StepServices {
  return {
    db: ctx.db,
    makeLlm: (onCost) => {
      const llm = fakeLlm();
      return {
        ...llm,
        generateStructured: async (opts) => {
          const res = await llm.generateStructured(opts);
          await onCost({
            provider: "anthropic",
            model: opts.model,
            operation: opts.operation,
            units: 180,
            unitType: "tokens",
            costUsd: 0.02,
            meta: { inputTokens: 100, outputTokens: 80 },
          });
          return res;
        },
      } as Llm;
    },
    makeFirecrawl: () => ({}) as never,
    fetch: (async () => new Response("ok")) as typeof fetch,
    publishEnv: { siteUrl: "https://ai-review.dev", revalidateSecret: null, indexNowKey: null },
  };
}

async function publishedSource(plusPrice = 12) {
  const [category] = await ctx.db.select().from(categories).limit(1);
  const { product } = await findOrCreateProduct(ctx.db, {
    name: "Acme",
    websiteUrl: "https://acme.dev",
    categoryId: category!.id,
  });
  await ctx.db.update(products).set({ tagline: "Project tracker for small teams" }).where(eq(products.id, product.id));
  const s1 = await upsertSource(ctx.db, {
    productId: product.id,
    url: "https://acme.dev",
    kind: "official",
    contentMd: "Acme",
  });
  const s2 = await upsertSource(ctx.db, {
    productId: product.id,
    url: "https://acme.dev/pricing",
    kind: "official",
    contentMd: "Pricing",
  });
  const blocks = JSON.parse(
    JSON.stringify(sampleBlocks(plusPrice)).replaceAll(S1, s1.id).replaceAll(S2, s2.id),
  ) as Block[];
  const article = await createArticle(ctx.db, {
    type: "review",
    productId: product.id,
    title: "Acme review",
    slug: "acme-review",
  });
  const version = await addArticleVersion(ctx.db, article.id, {
    blocks,
    overallScore: 8.1,
    seo: {
      title: "Acme Review 2026: Pricing, Features and Verdict",
      metaDescription:
        "Our hands-off review of Acme: what it costs, what it does well, where it falls short and who should pick it.",
      primaryKeyword: "acme review",
      secondaryKeywords: ["acme pricing"],
      intent: "review",
      internalLinks: [],
    },
    factCheck: {
      claims: [],
      supported: 0,
      unsupported: 0,
      outdated: 0,
      uncited: 0,
      fixedCount: 0,
      checkedAt: new Date().toISOString(),
    },
  });
  await ctx.db
    .update(articles)
    .set({ status: "published", publishedVersionId: version.id, publishedAt: new Date() })
    .where(eq(articles.id, article.id));
  return { article, version, product, blocks, sources: [s1.id, s2.id] };
}

describe("translate jobs (fake model)", () => {
  it("translates a published article into a German draft for review, then re-translates only changed sections", async () => {
    calls.length = 0;
    dropMarkerOnce = true;
    const { article, product } = await publishedSource(12);
    const { job } = await createTranslationJob(ctx.db, { sourceArticleId: article.id, locale: "de" });
    // A second request while the first is queued reuses the job.
    expect((await createTranslationJob(ctx.db, { sourceArticleId: article.id, locale: "de" })).created).toBe(false);

    const res = await runReviewJob(services(), job.id);
    expect(res.outcome).toBe("review");
    const de = await findTranslation(ctx.db, article.id, "de");
    expect(de).toMatchObject({
      locale: "de",
      type: "review",
      status: "in_review",
      slug: "de-acme-review",
      translationOfId: article.id,
    });
    expect((await getJob(ctx.db, job.id))?.articleId).toBe(de!.id);
    const v1 = await getCurrentVersion(ctx.db, de!.id);
    expect(v1?.seo).toMatchObject({
      title: "DE Acme Review 2026: Pricing, Features and Verdict",
      primaryKeyword: "de acme review",
    });
    expect(v1?.overallScore).toBe(8.1);
    // The dropped marker was retried (and would have been repaired); QA hard gates pass.
    expect(calls.filter((c) => c.operation === "translate").at(-1)?.keys).toEqual(["sec-pricing-p1|children"]);
    const qa = await computeQaScorecard(ctx.db, de!.id);
    const tChecks = qa.checks.filter((c) => c.key.startsWith("translation_"));
    expect(tChecks.filter((c) => c.hard).every((c) => c.passed)).toBe(true);
    expect(qa.checks.some((c) => c.key === "readability")).toBe(false);
    // Catalogue strings.
    const [p] = await ctx.db.select().from(products).where(eq(products.id, product.id));
    expect(p!.translations).toMatchObject({ de: { tagline: "DE Project tracker for small teams" } });

    // Coverage: in review, not stale.
    expect((await translationCoverage(ctx.db, "de"))[0]).toMatchObject({ sourceId: article.id, state: "in_review" });

    // Editor edits the German overview heading; the English article gets a new published version with a new price.
    await addArticleVersion(ctx.db, de!.id, {
      blocks: v1!.blocks.map((b) => (b.id === "sec-overview-h" ? { ...b, text: "Was Acme ist (redigiert)" } : b)),
      seo: v1!.seo,
      overallScore: v1!.overallScore,
      factCheck: v1!.factCheck,
    });
    const src = await getCurrentVersion(ctx.db, article.id);
    const v2 = await addArticleVersion(ctx.db, article.id, {
      blocks: src!.blocks.map((b) =>
        b.id === "sec-pricing-p1" && b.type === "paragraph"
          ? {
              ...b,
              children: b.children.map((c) => (c.marks.length ? c : { ...c, text: c.text.replace("$12", "$15") })),
            }
          : b,
      ),
      seo: src!.seo,
      overallScore: src!.overallScore,
      factCheck: src!.factCheck,
    });
    await ctx.db.update(articles).set({ publishedVersionId: v2.id }).where(eq(articles.id, article.id));
    expect((await translationCoverage(ctx.db, "de"))[0]?.state).toBe("stale");
    expect((await translationGroup(ctx.db, de!.id))?.translations[0]?.state).toBe("stale");

    calls.length = 0;
    const { job: job2 } = await createTranslationJob(ctx.db, { sourceArticleId: article.id, locale: "de" });
    await runReviewJob(services(), job2.id);
    expect(calls.filter((c) => c.operation === "translate").flatMap((c) => c.keys)).toEqual([
      "sec-pricing-h|text",
      "sec-pricing-p1|children",
    ]);
    const v3 = await getCurrentVersion(ctx.db, de!.id);
    expect(v3?.blocks.find((b) => b.id === "sec-overview-h")).toMatchObject({ text: "Was Acme ist (redigiert)" });
    expect(JSON.stringify(v3?.blocks.find((b) => b.id === "sec-pricing-p1"))).toContain("DE Plus costs 15 $");
    expect(v3?.changeNote).toBe("Re-translated from English v2: sec-pricing");
    expect((await findTranslation(ctx.db, article.id, "de"))?.translatedFromVersionId).toBe(v2.id);

    // The German article publishes like any other, with /de paths (and its English source) revalidated.
    await ctx.db.update(articles).set({ status: "approved" }).where(eq(articles.id, de!.id));
    // (The fixture has no rubric, so the general gates fail; translation gates were checked above.)
    await setVersionQa(ctx.db, v3!.id, {
      qaScorecard: { hardGatesPassed: true, checks: [], computedAt: new Date().toISOString() },
    });
    await publishArticle(ctx.db, de!.id, { ignoreCap: true });
    expect(await pathsForArticle(ctx.db, de!.id)).toEqual(
      expect.arrayContaining([
        "/de/reviews/de-acme-review",
        "/de",
        "/de/reviews",
        "/reviews/acme-review",
        "/de/feed.xml",
      ]),
    );
    expect(await queueAutoTranslations(ctx.db, de!.id)).toEqual([]);

    // Up to date: a third job does nothing.
    const { job: job3 } = await createTranslationJob(ctx.db, { sourceArticleId: article.id, locale: "de" });
    expect((await runReviewJob(services(), job3.id)).outcome).toBe("up_to_date");
  });

  it("queues auto-translations on publish only when the policy lists the locale", async () => {
    const { article } = await publishedSource();
    expect(await queueAutoTranslations(ctx.db, article.id)).toEqual([]);
    await setSetting(ctx.db, "i18n.policy", { enabledLocales: ["en", "de"], autoTranslate: ["de"] });
    const effects = await afterPublish(
      ctx.db,
      article.id,
      { siteUrl: "http://localhost:3000" },
      (async () => new Response("")) as typeof fetch,
    );
    expect(effects.translationJobs).toHaveLength(1);
    expect(await queueAutoTranslations(ctx.db, article.id)).toEqual([]);
    const job = await getJob(ctx.db, effects.translationJobs[0]!);
    expect(job).toMatchObject({
      preset: "translate",
      status: "queued",
      input: { sourceArticleId: article.id, locale: "de", trigger: "auto_publish" },
    });
  });

  it("refuses unpublished or non-English sources", async () => {
    const { product } = await publishedSource();
    const draft = await createArticle(ctx.db, { type: "review", productId: product.id, title: "Draft", slug: "draft" });
    await expect(createTranslationJob(ctx.db, { sourceArticleId: draft.id, locale: "de" })).rejects.toThrow(
      /Publish the English/,
    );
    await expect(createTranslationJob(ctx.db, { sourceArticleId: draft.id, locale: "fr" })).rejects.toThrow(
      /Unsupported/,
    );
  });
});
