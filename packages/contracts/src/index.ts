import { z } from "@hono/zod-openapi";
import { articleBodySchema } from "@repo/content";

/**
 * Public API v1 contracts (FR-API-1). These schemas generate the OpenAPI document and are the
 * only thing the mobile app depends on (NFR-13). Additive changes only within /v1.
 */

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string().openapi({ example: "Category not found" }),
    }),
  })
  .openapi("ErrorResponse");

export const HealthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    db: z.enum(["ok", "error"]),
    version: z.string(),
    time: z.iso.datetime(),
  })
  .openapi("HealthResponse");

export const CategorySchema = z
  .object({
    id: z.uuid(),
    slug: z.string().openapi({ example: "ai-tools" }),
    name: z.string().openapi({ example: "AI Tools" }),
    description: z.string().nullable(),
  })
  .openapi("Category");

export const CategoryListSchema = z.object({ data: z.array(CategorySchema) }).openapi("CategoryList");

export const ImageSchema = z
  .object({
    url: z.url(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    alt: z.string().nullable(),
    variants: z.array(z.object({ url: z.url(), width: z.number().int(), height: z.number().int() })),
  })
  .openapi("Image");

export const ReviewSummarySchema = z
  .object({
    slug: z.string().openapi({ example: "notion-review" }),
    title: z.string(),
    description: z.string().nullable(),
    score: z.number().nullable().openapi({ description: "Editorial score 0–10, computed from the rubric" }),
    publishedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    lastVerifiedAt: z.iso.datetime().nullable(),
    product: z.object({ slug: z.string().nullable(), name: z.string().nullable(), tagline: z.string().nullable() }),
    category: z.object({ slug: z.string(), name: z.string() }).nullable(),
    image: ImageSchema.nullable(),
    logo: ImageSchema.nullable(),
  })
  .openapi("ReviewSummary");

export const PaginationSchema = z
  .object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int().nullable() })
  .openapi("Pagination");

export const ReviewListSchema = z
  .object({ data: z.array(ReviewSummarySchema), pagination: PaginationSchema })
  .openapi("ReviewList");

export const SourceSchema = z
  .object({ id: z.uuid(), url: z.url(), title: z.string().nullable(), kind: z.string(), fetchedAt: z.iso.datetime() })
  .openapi("Source");

/**
 * Portable content blocks (constraint C-1): render natively on mobile; never HTML. Registered with
 * zod's native `.meta()`: content schemas may be created before @hono/zod-openapi patches zod.
 */
export const ArticleBodySchema = articleBodySchema.meta({
  id: "ArticleBody",
  description:
    "Typed content blocks. Citation marks reference `sources[].id`; go-link marks and CTA blocks reference `links.go`.",
});

/** A review video uploaded to YouTube (FR-VID-4). Renders and drafts are never exposed. */
export const VideoSchema = z
  .object({
    kind: z.enum(["short", "long"]).openapi({ description: "short = vertical 9:16, long = 16:9" }),
    youtubeId: z.string(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    durationSeconds: z.number().int().nullable(),
    uploadedAt: z.iso.datetime().nullable(),
    embedUrl: z.url(),
    watchUrl: z.url(),
    thumbnailUrl: z.url(),
  })
  .openapi("Video");

export const ReviewDetailSchema = z
  .object({
    slug: z.string(),
    title: z.string(),
    seo: z.object({ title: z.string(), description: z.string().nullable(), canonicalUrl: z.url() }),
    score: z.number().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    lastVerifiedAt: z.iso.datetime().nullable(),
    aiDisclosure: z.string().nullable(),
    author: z.object({ slug: z.string(), name: z.string() }).nullable(),
    product: z.object({
      slug: z.string(),
      name: z.string(),
      tagline: z.string().nullable(),
      websiteUrl: z.url(),
      logo: ImageSchema.nullable(),
    }),
    category: z.object({ slug: z.string(), name: z.string() }).nullable(),
    blocks: ArticleBodySchema,
    media: z
      .record(z.string(), ImageSchema)
      .openapi({ description: "Images referenced by image blocks, keyed by asset id" }),
    sources: z.array(SourceSchema),
    links: z.object({
      go: z
        .string()
        .nullable()
        .openapi({ description: "Go-link slug; open `${webUrl}/go/{slug}?p=<placement>&a=<review slug>`" }),
      goBaseUrl: z.url(),
      web: z.url(),
    }),
    competitors: z.array(
      z.object({ name: z.string(), reviewSlug: z.string().nullable(), note: z.string().nullable() }),
    ),
    videos: z.array(VideoSchema).openapi({ description: "Video reviews on YouTube; empty when none" }),
  })
  .openapi("ReviewDetail");

export const ProductSummarySchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    tagline: z.string().nullable(),
    websiteUrl: z.url(),
    category: z.object({ slug: z.string(), name: z.string() }).nullable(),
    reviewSlug: z.string().nullable(),
    score: z.number().nullable(),
    logo: ImageSchema.nullable(),
  })
  .openapi("ProductSummary");

export const ProductListSchema = z
  .object({ data: z.array(ProductSummarySchema), pagination: PaginationSchema })
  .openapi("ProductList");

export const PricingTierSchema = z
  .object({
    name: z.string(),
    price: z.number().nullable(),
    currency: z.string(),
    period: z.enum(["month", "year", "one_time", "usage", "custom"]),
    highlights: z.array(z.string()),
  })
  .openapi("PricingTier");

export const ProductDetailSchema = ProductSummarySchema.extend({
  pricing: z.object({ tiers: z.array(PricingTierSchema), verifiedAt: z.iso.datetime().nullable() }).nullable(),
  goSlug: z.string().nullable(),
}).openapi("ProductDetail");

export const CategoryDetailSchema = CategorySchema.extend({ reviews: z.array(ReviewSummarySchema) }).openapi(
  "CategoryDetail",
);

export const ArticleTypeSchema = z
  .enum(["review", "comparison", "alternatives", "best_of"])
  .openapi("ArticleType", { description: "Web paths: /reviews, /compare, /alternatives, /best + /{slug}" });

export const SearchResultSchema = ReviewSummarySchema.extend({
  type: ArticleTypeSchema,
  url: z.url().openapi({ description: "Canonical web URL of the article" }),
}).openapi("SearchResult");

export const SearchResultListSchema = z
  .object({ data: z.array(SearchResultSchema), pagination: PaginationSchema })
  .openapi("SearchResultList");

/** Comparisons, alternatives lists and best-of lists (FR-CON-8). */
export const GuideTypeSchema = z.enum(["comparison", "alternatives", "best_of"]).openapi("GuideType");

export const GuideSummarySchema = z
  .object({
    type: GuideTypeSchema,
    slug: z.string().openapi({ example: "notion-vs-coda" }),
    title: z.string(),
    description: z.string().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    lastVerifiedAt: z.iso.datetime().nullable(),
    productCount: z.number().int(),
    category: z.object({ slug: z.string(), name: z.string() }).nullable(),
    image: ImageSchema.nullable(),
    url: z.url(),
  })
  .openapi("GuideSummary");

export const GuideListSchema = z
  .object({ data: z.array(GuideSummarySchema), pagination: PaginationSchema })
  .openapi("GuideList");

export const GuideDetailSchema = z
  .object({
    type: GuideTypeSchema,
    slug: z.string(),
    title: z.string(),
    seo: z.object({ title: z.string(), description: z.string().nullable(), canonicalUrl: z.url() }),
    publishedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    lastVerifiedAt: z.iso.datetime().nullable(),
    aiDisclosure: z.string().nullable(),
    author: z.object({ slug: z.string(), name: z.string() }).nullable(),
    category: z.object({ slug: z.string(), name: z.string() }).nullable(),
    products: z
      .array(
        z.object({
          id: z.uuid(),
          slug: z.string(),
          name: z.string(),
          tagline: z.string().nullable(),
          websiteUrl: z.url(),
          reviewSlug: z.string().nullable(),
          score: z.number().nullable(),
          go: z.string().nullable().openapi({ description: "Go-link slug for this product's CTAs" }),
          discontinued: z.boolean(),
        }),
      )
      .openapi({ description: "Products in article order; comparison_table productIds reference `id`" }),
    blocks: ArticleBodySchema,
    media: z.record(z.string(), ImageSchema),
    sources: z.array(SourceSchema),
    links: z.object({ goBaseUrl: z.url(), web: z.url() }),
  })
  .openapi("GuideDetail");

export const DealSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    description: z.string().nullable(),
    code: z.string().nullable().openapi({ description: "Promo code, if the deal needs one" }),
    discountText: z.string().nullable().openapi({ example: "30% off first year" }),
    endsAt: z.iso.datetime().nullable(),
    product: z.object({ slug: z.string(), name: z.string(), logo: ImageSchema.nullable() }),
    category: z.object({ slug: z.string(), name: z.string() }).nullable(),
    reviewSlug: z.string(),
    links: z.object({
      go: z.string().nullable().openapi({ description: "Go-link slug; open `${webUrl}/go/{slug}?p=deals`" }),
      web: z.url(),
    }),
  })
  .openapi("Deal");

export const DealListSchema = z.object({ data: z.array(DealSchema) }).openapi("DealList");

const turnstileToken = z
  .string()
  .max(4096)
  .optional()
  .openapi({ description: "Cloudflare Turnstile token; required when the server has Turnstile enabled" });

export const VoteRequestSchema = z.object({ helpful: z.boolean(), turnstileToken }).openapi("VoteRequest");

export const ReportRequestSchema = z
  .object({
    article: z.string().max(120).optional().openapi({ description: "Review slug the report is about" }),
    kind: z.enum(["pricing", "error", "other"]).default("other"),
    message: z.string().min(5).max(2000),
    email: z.email().max(200).optional(),
    turnstileToken,
  })
  .openapi("ReportRequest");

export const NewsletterRequestSchema = z
  .object({ email: z.email().max(200), source: z.string().max(60).optional(), turnstileToken })
  .openapi("NewsletterRequest");

export const AcceptedResponseSchema = z
  .object({ status: z.literal("accepted"), message: z.string() })
  .openapi("AcceptedResponse");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type CategoryList = z.infer<typeof CategoryListSchema>;
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;
export type ReviewDetail = z.infer<typeof ReviewDetailSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type ProductSummary = z.infer<typeof ProductSummarySchema>;
export type ProductDetail = z.infer<typeof ProductDetailSchema>;
export type Image = z.infer<typeof ImageSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type Deal = z.infer<typeof DealSchema>;
export type GuideSummary = z.infer<typeof GuideSummarySchema>;
export type GuideDetail = z.infer<typeof GuideDetailSchema>;

export const API_VERSION = "1.3.0";
