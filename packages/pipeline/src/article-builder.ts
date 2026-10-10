import { PLACEMENTS } from "@repo/affiliate";
import {
  computeOverallScore,
  inlineText,
  parseInline,
  type ArticleBody,
  type Block,
  type Citation,
  type FactSheet,
} from "@repo/content";
import { z } from "zod";

export const SECTION_KEYS = [
  "overview",
  "features",
  "ease_of_use",
  "pricing",
  "hands_on",
  "support",
  "security",
  "alternatives",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const sectionDraftSchema = z.object({
  key: z.enum(SECTION_KEYS),
  heading: z.string(),
  paragraphs: z.array(z.string()),
  bullets: z.array(z.string()),
});
export type SectionDraft = z.infer<typeof sectionDraftSchema>;

/** Model-facing article draft (write step). Strings use the inline syntax with [^S#] citations. */
export const articleDraftSchema = z.object({
  title: z.string(),
  metaDescription: z.string(),
  verdictSummary: z.string(),
  bestFor: z.array(z.string()),
  notFor: z.array(z.string()),
  intro: z.array(z.string()),
  sections: z.array(sectionDraftSchema),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  rubric: z.array(
    z.object({ key: z.string(), score: z.number(), justification: z.string(), refs: z.array(z.string()) }),
  ),
  comparisonRows: z.array(z.object({ label: z.string(), values: z.array(z.string()) })),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  finalVerdict: z.array(z.string()),
  ctaLabel: z.string(),
  screenshotCaptions: z.array(z.object({ role: z.string(), caption: z.string(), alt: z.string() })),
});
export type ArticleDraft = z.infer<typeof articleDraftSchema>;

export interface BuildContext {
  refToId: (ref: string) => string | null;
  goSlug: string;
  rubric: ReadonlyArray<{ key: string; label: string; weight: number }>;
  /** Reviewed product first, then competitors in the order given to the model. */
  comparisonProductIds: string[];
  factSheet: FactSheet | null;
  factSheetAt: Date;
  screenshots: Array<{ role: string; assetId: string }>;
}

const plain = (md: string) => inlineText(parseInline(md, { resolveCitation: () => null })).trim();

function citationsFromRefs(refs: string[], refToId: (r: string) => string | null): Citation[] {
  return [...new Set(refs.map((r) => refToId(r.replace(/[^A-Za-z0-9]/g, ""))).filter((x): x is string => !!x))].map(
    (sourceId) => ({ sourceId }),
  );
}

export function pricingTableFromFactSheet(sheet: FactSheet | null, at: Date): Block | null {
  const tiers = sheet?.pricing?.tiers;
  if (!tiers || tiers.value.length === 0) return null;
  return {
    id: "pricing-table",
    type: "pricing_table",
    verifiedAt: at.toISOString(),
    tiers: tiers.value.map((t) => ({
      name: t.name,
      price: t.price,
      currency: t.currency,
      period: t.period,
      highlights: [...t.highlights, ...t.limits].slice(0, 6),
      citations: tiers.citations,
    })),
  };
}

/** Screenshot role "screenshot:pricing:desktop" -> sortable rank (desktop before mobile, home first). */
function shotRank(role: string) {
  return (role.includes(":home:") ? 0 : 2) + (role.endsWith(":mobile") ? 1 : 0);
}

export function sectionBlocks(section: SectionDraft, refToId: BuildContext["refToId"]): Block[] {
  const opts = { resolveCitation: refToId };
  const blocks: Block[] = [{ id: `sec-${section.key}-h`, type: "heading", level: 2, text: plain(section.heading) }];
  section.paragraphs
    .filter((p) => p.trim())
    .forEach((p, i) =>
      blocks.push({ id: `sec-${section.key}-p${i}`, type: "paragraph", children: parseInline(p, opts) }),
    );
  const bullets = section.bullets.filter((b) => b.trim());
  if (bullets.length) {
    blocks.push({
      id: `sec-${section.key}-list`,
      type: "list",
      ordered: false,
      items: bullets.map((b) => parseInline(b, opts)),
    });
  }
  return blocks;
}

/**
 * Assembles the fixed review contract (FR-CON-2) from the model draft plus deterministic blocks:
 * verdict + CTA, intro, sections, pricing table from the fact sheet, pros/cons, screenshots,
 * rubric with a computed overall score (FR-CON-3), comparison table, FAQ, final verdict + CTA,
 * sources. CTAs reference the go-slug with a placement code (FR-WEB-5).
 */
export function buildReviewBlocks(
  draft: ArticleDraft,
  ctx: BuildContext,
): { blocks: ArticleBody; overallScore: number } {
  const opts = { resolveCitation: ctx.refToId };
  const dims = ctx.rubric.flatMap((dim) => {
    const d = draft.rubric.find((r) => r.key === dim.key);
    if (!d) return [];
    const score = Math.min(10, Math.max(1, Math.round(d.score * 2) / 2));
    return [
      {
        key: dim.key,
        label: dim.label,
        weight: dim.weight,
        score,
        justification: plain(d.justification),
        citations: citationsFromRefs(
          [...d.refs, ...[...d.justification.matchAll(/\[\^([A-Za-z0-9]+)\]/g)].map((m) => m[1]!)],
          ctx.refToId,
        ),
      },
    ];
  });
  if (dims.length === 0) throw new Error("The draft has no rubric scores; cannot compute the overall score");
  const overallScore = computeOverallScore(dims);
  const label = draft.ctaLabel.trim().slice(0, 60) || "Visit website";
  const cta = (placement: string, note?: string): Block => ({
    id: `cta-${placement}`,
    type: "cta",
    goSlug: ctx.goSlug,
    placement,
    label,
    ...(note ? { note } : {}),
  });

  const blocks: Block[] = [
    {
      id: "verdict",
      type: "verdict",
      score: overallScore,
      summary: plain(draft.verdictSummary),
      bestFor: draft.bestFor.map(plain).filter(Boolean).slice(0, 6),
      notFor: draft.notFor.map(plain).filter(Boolean).slice(0, 6),
    },
    cta(PLACEMENTS.verdict),
    ...draft.intro
      .filter((p) => p.trim())
      .map((p, i): Block => ({ id: `intro-${i}`, type: "paragraph", children: parseInline(p, opts) })),
  ];

  const byKey = new Map(draft.sections.map((s) => [s.key, s]));
  for (const key of SECTION_KEYS) {
    const section = byKey.get(key);
    if (key === "alternatives") {
      blocks.push({ id: "scores-h", type: "heading", level: 2, text: "How we score it" });
      blocks.push({ id: "rubric", type: "rubric", dimensions: dims });
    }
    if (!section) continue;
    const sec = sectionBlocks(section, ctx.refToId);
    if (key === "pricing") {
      const table = pricingTableFromFactSheet(ctx.factSheet, ctx.factSheetAt);
      blocks.push(sec[0]!, ...(table ? [table] : []), ...sec.slice(1), cta(PLACEMENTS.pricing));
      blocks.push({ id: "pros-cons-h", type: "heading", level: 2, text: "Pros and cons" });
      blocks.push({
        id: "pros-cons",
        type: "pros_cons",
        pros: draft.pros.map(plain).filter(Boolean),
        cons: draft.cons.map(plain).filter(Boolean),
      });
      continue;
    }
    if (key === "hands_on") {
      const shots = [...ctx.screenshots].sort((a, b) => shotRank(a.role) - shotRank(b.role)).slice(0, 4);
      blocks.push(...sec);
      for (const shot of shots) {
        const caption = draft.screenshotCaptions.find((c) => c.role === shot.role);
        blocks.push({
          id: `shot-${shot.role.replace(/[^a-z0-9]+/gi, "-")}`,
          type: "image",
          assetId: shot.assetId,
          ...(caption ? { caption: plain(caption.caption) } : {}),
        });
      }
      continue;
    }
    if (key === "alternatives") {
      blocks.push(...sec);
      const ids = ctx.comparisonProductIds.slice(0, 4);
      const rows = draft.comparisonRows
        .map((r) => ({ label: plain(r.label), values: ids.map((_, i) => plain(r.values[i] ?? "—") || "—") }))
        .filter((r) => r.label);
      if (ids.length >= 2 && rows.length > 0) {
        blocks.push({ id: "comparison", type: "comparison_table", productIds: ids, rows });
        blocks.push(cta(PLACEMENTS.comparison));
      }
      continue;
    }
    blocks.push(...sec);
  }

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
  draft.finalVerdict
    .filter((p) => p.trim())
    .forEach((p, i) => blocks.push({ id: `final-${i}`, type: "paragraph", children: parseInline(p, opts) }));
  blocks.push(cta(PLACEMENTS.final));
  blocks.push({ id: "sources", type: "sources" });
  return { blocks, overallScore };
}

/** Alt text for screenshots, keyed by asset id, from the draft captions. */
export function screenshotAltText(draft: ArticleDraft, screenshots: Array<{ role: string; assetId: string }>) {
  const out = new Map<string, string>();
  for (const s of screenshots) {
    const c = draft.screenshotCaptions.find((x) => x.role === s.role);
    if (c?.alt) out.set(s.assetId, plain(c.alt).slice(0, 125));
  }
  return out;
}
