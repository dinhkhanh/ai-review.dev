import { z } from "zod";
import { citationSchema } from "./citations";

/**
 * Portable article content (constraint C-1). Stored as JSON, rendered by React on web
 * and natively on mobile. Never store HTML in blocks.
 */

export const inlineMarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("link"), href: z.url() }),
  /** Monetised link through the go-link redirect (FR-AFF-6). Rendered with rel="sponsored". */
  z.object({ type: z.literal("golink"), slug: z.string().min(1), placement: z.string().min(1) }),
  z.object({ type: z.literal("citation"), citation: citationSchema }),
]);
export type InlineMark = z.infer<typeof inlineMarkSchema>;

export const inlineSchema = z.object({
  text: z.string(),
  marks: z.array(inlineMarkSchema).default([]),
});
export type Inline = z.infer<typeof inlineSchema>;

const blockBase = {
  /** Stable id so sections can be regenerated or commented on individually (FR-CON-2, FR-QA-3). */
  id: z.string().min(1),
};

export const rubricDimensionSchema = z.object({
  key: z.string(),
  label: z.string(),
  weight: z.number().min(0).max(1),
  score: z.number().min(1).max(10),
  justification: z.string(),
  citations: z.array(citationSchema).default([]),
});
export type RubricDimension = z.infer<typeof rubricDimensionSchema>;

export const blockSchema = z.discriminatedUnion("type", [
  z.object({
    ...blockBase,
    type: z.literal("heading"),
    level: z.union([z.literal(2), z.literal(3)]),
    text: z.string(),
  }),
  z.object({ ...blockBase, type: z.literal("paragraph"), children: z.array(inlineSchema) }),
  z.object({
    ...blockBase,
    type: z.literal("list"),
    ordered: z.boolean().default(false),
    items: z.array(z.array(inlineSchema)),
  }),
  z.object({
    ...blockBase,
    type: z.literal("verdict"),
    score: z.number().min(0).max(10),
    summary: z.string(),
    bestFor: z.array(z.string()).default([]),
    notFor: z.array(z.string()).default([]),
  }),
  z.object({ ...blockBase, type: z.literal("rubric"), dimensions: z.array(rubricDimensionSchema) }),
  z.object({
    ...blockBase,
    type: z.literal("pricing_table"),
    verifiedAt: z.iso.datetime(),
    tiers: z.array(
      z.object({
        name: z.string(),
        price: z.number().nullable(),
        currency: z.string().length(3).default("USD"),
        period: z.enum(["month", "year", "one_time", "usage", "custom"]),
        highlights: z.array(z.string()).default([]),
        citations: z.array(citationSchema).default([]),
      }),
    ),
  }),
  z.object({ ...blockBase, type: z.literal("pros_cons"), pros: z.array(z.string()), cons: z.array(z.string()) }),
  z.object({
    ...blockBase,
    type: z.literal("comparison_table"),
    productIds: z.array(z.uuid()).min(2),
    rows: z.array(z.object({ label: z.string(), values: z.array(z.string()) })),
  }),
  z.object({ ...blockBase, type: z.literal("image"), assetId: z.uuid(), caption: z.string().optional() }),
  z.object({ ...blockBase, type: z.literal("video"), videoId: z.uuid() }),
  z.object({
    ...blockBase,
    type: z.literal("faq"),
    items: z.array(z.object({ question: z.string(), answer: z.array(inlineSchema) })),
  }),
  z.object({
    ...blockBase,
    type: z.literal("cta"),
    goSlug: z.string().min(1),
    placement: z.string().min(1),
    label: z.string(),
    note: z.string().optional(),
  }),
  z.object({
    ...blockBase,
    type: z.literal("callout"),
    tone: z.enum(["info", "warning", "tip"]),
    children: z.array(inlineSchema),
  }),
  z.object({ ...blockBase, type: z.literal("sources") }),
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];

export const articleBodySchema = z.array(blockSchema);
export type ArticleBody = z.infer<typeof articleBodySchema>;
