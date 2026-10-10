import type { Block, Seo } from "@repo/content";
import {
  findTranslation,
  getArticle,
  getCurrentVersion,
  getProduct,
  getVersion,
  missingCatalogStrings,
  saveTranslation,
  setCategoryTranslation,
  setJobLinks,
  setProductTranslation,
} from "@repo/core";
import { z } from "zod";
import { defineStep, mapLimit, type StepContext } from "../step";
import type { ResolvedPrompt } from "../prompts";
import { planRetranslation, unitOf } from "./diff";
import { translationChecks } from "./qa";
import { applySegments, extractSegments, repairCitations, segmentProblems, type Segment } from "./segments";

/** Model-facing schema: flat list of key/text pairs (structured outputs). */
export const translatedSegmentsSchema = z.object({
  segments: z.array(z.object({ key: z.string(), text: z.string() })),
});

const LOCALE_NAMES: Record<string, string> = { de: "German (de-DE; readers in Germany, Austria, Switzerland)" };
/** Source characters per model call; sections are never split across calls. */
const CHUNK_CHARS = 9_000;

export const translateInputSchema = z.object({
  sourceArticleId: z.uuid(),
  locale: z.enum(["de"]),
  /** Re-translate everything, ignoring the current translation and editor edits. */
  full: z.boolean().optional(),
});

/** Cuts text to `max` characters at a word boundary. */
export function clampText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

/** Groups segments into model calls of about CHUNK_CHARS, keeping each section/unit together. */
export function chunkSegments(segments: Segment[], maxChars = CHUNK_CHARS): Segment[][] {
  const units: Segment[][] = [];
  for (const seg of segments) {
    const unit = seg.blockId === "meta" ? "meta" : unitOf(seg.blockId);
    const last = units[units.length - 1];
    if (last && (last[0]!.blockId === "meta" ? "meta" : unitOf(last[0]!.blockId)) === unit) last.push(seg);
    else units.push([seg]);
  }
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  for (const unit of units) {
    const len = unit.reduce((n, s) => n + s.text.length, 0);
    if (current.length && size + len > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(...unit);
    size += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

interface TranslateDeps {
  ctx: Pick<StepContext, "llm" | "log">;
  prompt: ResolvedPrompt;
  locale: string;
  title: string;
  glossary: string[];
}

async function callModel(deps: TranslateDeps, segments: Segment[], feedback: string[] = []) {
  const res = await deps.ctx.llm.generateStructured({
    model: deps.prompt.model,
    effort: deps.prompt.effort,
    system: deps.prompt.system,
    operation: "translate",
    maxTokens: 32_000,
    schema: translatedSegmentsSchema,
    prompt: [
      `Target language: ${LOCALE_NAMES[deps.locale] ?? deps.locale}`,
      `Article: ${deps.title}`,
      deps.glossary.length ? `Glossary (keep exactly as written): ${deps.glossary.join(", ")}` : null,
      feedback.length
        ? `Your previous translation of these segments had problems; fix them:\n${feedback.join("\n")}`
        : null,
      `Segments (${segments.length}):\n${JSON.stringify(segments.map((s) => ({ key: s.key, text: s.text })))}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  return new Map(res.data.segments.map((s) => [s.key, s.text]));
}

/**
 * Translates segments chunk by chunk (3 calls in flight), then retries once the segments that came
 * back missing or with lost citation markers / changed link targets, and finally re-attaches any
 * citation the model still dropped. Returns key → translated text.
 */
export async function translateSegments(deps: TranslateDeps, segments: Segment[]) {
  const results = await mapLimit(chunkSegments(segments), 3, (chunk) => callModel(deps, chunk));
  const out = new Map<string, string>();
  for (const r of results) for (const [k, v] of r) out.set(k, v);

  const byKey = new Map(segments.map((s) => [s.key, s]));
  const retry = segments.filter((s) => !out.has(s.key) || segmentProblems(s, out.get(s.key)!).length > 0);
  let retried = 0;
  if (retry.length) {
    const feedback = retry.map((s) =>
      out.has(s.key) ? `- ${s.key}: ${segmentProblems(s, out.get(s.key)!).join("; ")}` : `- ${s.key}: missing`,
    );
    deps.ctx.log("retrying segments", { count: retry.length });
    const again = await callModel(deps, retry, feedback);
    for (const [k, v] of again) {
      const seg = byKey.get(k);
      if (!seg) continue;
      if (!out.has(k) || segmentProblems(seg, v).length <= segmentProblems(seg, out.get(k)!).length) out.set(k, v);
    }
    retried = retry.length;
  }
  let repaired = 0;
  for (const seg of segments) {
    const text = out.get(seg.key);
    if (text === undefined) continue;
    const fixed = repairCitations(seg, text);
    repaired += fixed.repaired;
    out.set(seg.key, fixed.text);
  }
  // Keys the model invented are ignored.
  for (const k of [...out.keys()]) if (!byKey.has(k)) out.delete(k);
  return { translated: out, retried, repaired, missing: segments.filter((s) => !out.has(s.key)).map((s) => s.key) };
}

/** Title and SEO fields as `meta|…` segments (anchors of internal links included). */
export function metaSegments(title: string, seo: Seo | null): Segment[] {
  const seg = (path: string, text: string): Segment => ({ key: `meta|${path}`, blockId: "meta", text, inline: false });
  const out = [seg("title", title)];
  if (seo) {
    out.push(seg("seoTitle", seo.title), seg("metaDescription", seo.metaDescription));
    if (seo.primaryKeyword) out.push(seg("primaryKeyword", seo.primaryKeyword));
    seo.secondaryKeywords.forEach((k, i) => out.push(seg(`secondaryKeywords.${i}`, k)));
    seo.internalLinks.forEach((l, i) => out.push(seg(`internalLinks.${i}`, l.anchor)));
  }
  return out.filter((s) => s.text.trim());
}

/**
 * translate (phase 3 second locale): makes or updates the `locale` version of a published English
 * article. First run: every block. Later runs (the English article published a newer version):
 * only the sections that changed are re-translated; the rest keeps the translation as the editor
 * left it. Structure, citations, CTAs, scores and prices are copied from the source; only text is
 * translated. The source's fact-check report carries over (the facts are the same), and the
 * deterministic translation QA runs before saving.
 */
export const translateStep = defineStep({
  name: "translate",
  input: translateInputSchema,
  output: z.object({
    articleId: z.string(),
    versionId: z.string().nullable(),
    mode: z.enum(["full", "sections", "up_to_date"]),
    sourceVersion: z.number(),
    units: z.array(z.string()),
    translatedSegments: z.number(),
    keptBlocks: z.number(),
    retried: z.number(),
    repairedCitations: z.number(),
    missing: z.array(z.string()),
    qaFailed: z.array(z.string()),
  }),
  async run(ctx, input) {
    const source = await getArticle(ctx.db, input.sourceArticleId);
    if (!source?.publishedVersionId) throw new Error("Source article is not published");
    if (source.locale !== "en") throw new Error("Only English articles can be translated");
    const sourceVersion = await getVersion(ctx.db, source.publishedVersionId);
    if (!sourceVersion) throw new Error("Published source version not found");

    const existing = await findTranslation(ctx.db, source.id, input.locale);
    if (existing) await setJobLinks(ctx.db, ctx.jobId, { articleId: existing.id });
    if (existing && existing.translatedFromVersionId === sourceVersion.id && !input.full) {
      ctx.log("translation already reflects the published English version");
      return {
        output: {
          articleId: existing.id,
          versionId: existing.currentVersionId,
          mode: "up_to_date" as const,
          sourceVersion: sourceVersion.version,
          units: [],
          translatedSegments: 0,
          keptBlocks: 0,
          retried: 0,
          repairedCitations: 0,
          missing: [],
          qaFailed: [],
        },
      };
    }

    const current = existing ? await getCurrentVersion(ctx.db, existing.id) : null;
    const oldSource = existing?.translatedFromVersionId
      ? await getVersion(ctx.db, existing.translatedFromVersionId)
      : null;
    const incremental = !!(existing && current && oldSource && !input.full);
    const plan = incremental
      ? planRetranslation(oldSource!.blocks, sourceVersion.blocks, current!.blocks)
      : { plan: sourceVersion.blocks.map((block) => ({ kind: "source" as const, block })), units: [] as string[] };
    const toTranslate = plan.plan.filter((p) => p.kind === "source").map((p) => p.block);

    // Title/SEO: re-translated on the first run, or when the English SEO changed.
    const metaChanged = !incremental || JSON.stringify(oldSource!.seo) !== JSON.stringify(sourceVersion.seo);
    const set = extractSegments(toTranslate);
    const segments = [...(metaChanged ? metaSegments(source.title, sourceVersion.seo) : []), ...set.segments];

    const productIds = source.productIds.length ? source.productIds : source.productId ? [source.productId] : [];
    const productNames = (await Promise.all(productIds.map((id) => getProduct(ctx.db, id)))).flatMap((p) =>
      p ? [p.name] : [],
    );
    const tierNames = sourceVersion.blocks.flatMap((b) =>
      b.type === "pricing_table" ? b.tiers.map((t) => t.name) : [],
    );
    const glossary = [...new Set([...productNames, ...tierNames, "AI Review", "ai-review.dev"])];

    const prompt = await ctx.prompt("translate");
    ctx.log("translating", {
      mode: incremental ? "sections" : "full",
      units: plan.units,
      segments: segments.length,
      blocks: toTranslate.length,
    });
    const result = segments.length
      ? await translateSegments({ ctx, prompt, locale: input.locale, title: source.title, glossary }, segments)
      : { translated: new Map<string, string>(), retried: 0, repaired: 0, missing: [] as string[] };

    const translatedBlocks = new Map(applySegments(toTranslate, set, result.translated).map((b) => [b.id, b]));
    const blocks: Block[] = plan.plan.map((p) => (p.kind === "source" ? translatedBlocks.get(p.block.id)! : p.block));

    // Title and SEO.
    const m = (path: string) => result.translated.get(`meta|${path}`);
    let title = existing?.title ?? source.title;
    let seo: Seo | null = current?.seo ?? null;
    if (metaChanged) {
      title = clampText(m("title") ?? source.title, 200);
      const s = sourceVersion.seo;
      if (s) {
        const links: Seo["internalLinks"] = [];
        for (const [i, link] of s.internalLinks.entries()) {
          const target = await findTranslation(ctx.db, link.articleId, input.locale);
          if (target) links.push({ articleId: target.id, anchor: m(`internalLinks.${i}`) ?? link.anchor });
        }
        seo = {
          ...s,
          title: clampText(m("seoTitle") ?? s.title, 70),
          metaDescription: clampText(m("metaDescription") ?? s.metaDescription, 170),
          primaryKeyword: (m("primaryKeyword") ?? s.primaryKeyword).toLowerCase(),
          secondaryKeywords: s.secondaryKeywords.map((k, i) => (m(`secondaryKeywords.${i}`) ?? k).toLowerCase()),
          internalLinks: links,
          // The graphics step renders a German OG image.
          ogImageAssetId: undefined,
        };
      } else seo = null;
    }

    const qa = translationChecks(sourceVersion.blocks, blocks, { locale: input.locale });
    const saved = await saveTranslation(ctx.db, {
      sourceArticleId: source.id,
      sourceVersionId: sourceVersion.id,
      locale: input.locale,
      title,
      blocks,
      seo,
      overallScore: sourceVersion.overallScore,
      factCheck: sourceVersion.factCheck,
      promptVersions: { ...(current?.promptVersions ?? {}), translate: prompt.version },
      changeNote: incremental
        ? `Re-translated from English v${sourceVersion.version}: ${plan.units.join(", ") || "no changed sections"}`
        : `Translated from English v${sourceVersion.version}`,
      jobId: ctx.jobId,
    });
    await setJobLinks(ctx.db, ctx.jobId, { articleId: saved.articleId });
    ctx.log("translation saved", { version: saved.version, qaFailed: qa.failed, repaired: result.repaired });
    return {
      output: {
        articleId: saved.articleId,
        versionId: saved.versionId,
        mode: incremental ? ("sections" as const) : ("full" as const),
        sourceVersion: sourceVersion.version,
        units: plan.units,
        translatedSegments: result.translated.size,
        keptBlocks: plan.plan.filter((p) => p.kind === "keep").length,
        retried: result.retried,
        repairedCitations: result.repaired,
        missing: result.missing,
        qaFailed: qa.failed,
      },
      promptVersion: prompt.version,
    };
  },
});

export const catalogSchema = z.object({ items: z.array(z.object({ key: z.string(), text: z.string() })) });

/**
 * translate_catalog: category name/description and product taglines the translated article shows,
 * when their `translations.<locale>` entry is missing. Editors can override them in the CMS.
 */
export const translateCatalogStep = defineStep({
  name: "translate_catalog",
  input: z.object({ articleId: z.uuid(), locale: z.enum(["de"]) }),
  output: z.object({ translated: z.number() }),
  async run(ctx, input) {
    const missing = await missingCatalogStrings(ctx.db, input.articleId, input.locale);
    if (missing.length === 0) return { output: { translated: 0 } };
    const prompt = await ctx.prompt("translate_catalog");
    const key = (m: (typeof missing)[number]) => `${m.kind}:${m.id}:${m.field}`;
    const res = await ctx.llm.generateStructured({
      model: prompt.model,
      effort: prompt.effort,
      system: prompt.system,
      operation: "translate_catalog",
      maxTokens: 4_000,
      schema: catalogSchema,
      prompt: `Target language: ${LOCALE_NAMES[input.locale] ?? input.locale}\n\nItems:\n${JSON.stringify(
        missing.map((m) => ({ key: key(m), field: m.field, text: m.text })),
      )}`,
    });
    const byKey = new Map(res.data.items.map((i) => [i.key, i.text.trim()]));
    let translated = 0;
    for (const m of missing) {
      const text = byKey.get(key(m));
      if (!text) continue;
      if (m.kind === "category") await setCategoryTranslation(ctx.db, m.id, input.locale, { [m.field]: text });
      else await setProductTranslation(ctx.db, m.id, input.locale, { tagline: text });
      translated++;
    }
    ctx.log("catalogue strings translated", { translated, of: missing.length });
    return { output: { translated }, promptVersion: prompt.version };
  },
});
