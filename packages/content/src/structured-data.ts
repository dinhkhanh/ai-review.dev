import type { ArticleBody } from "./blocks";
import type { FactSheet } from "./fact-sheet";
import { inlineText } from "./inline-markdown";

/** Inputs for the review page's JSON-LD (FR-CON-9). */
export interface ReviewStructuredDataInput {
  siteUrl: string;
  siteName: string;
  url: string;
  title: string;
  description: string;
  publishedAt: Date | null;
  updatedAt: Date;
  imageUrl?: string | null;
  author: { name: string; url: string };
  product: { name: string; websiteUrl: string; category?: string | null; logoUrl?: string | null };
  /** Our editorial score (0-10). Never an aggregate of users we did not survey. */
  score: number | null;
  factSheet?: FactSheet | null;
  blocks: ArticleBody;
  breadcrumbs: Array<{ name: string; url: string }>;
  /** Uploaded review videos (FR-VID-4) → VideoObject. */
  videos?: StructuredVideo[];
}

export interface StructuredVideo {
  name: string;
  description: string;
  thumbnailUrl: string;
  uploadDate: Date;
  embedUrl: string;
  watchUrl: string;
  durationSeconds: number | null;
}

/** One VideoObject per uploaded video (FR-CON-9); also usable on its own next to other JSON-LD. */
export function buildVideoStructuredData(videos: StructuredVideo[]): JsonLd[] {
  return videos.map((v) => ({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: v.name,
    description: v.description,
    thumbnailUrl: [v.thumbnailUrl],
    uploadDate: v.uploadDate.toISOString(),
    embedUrl: v.embedUrl,
    url: v.watchUrl,
    ...(v.durationSeconds ? { duration: isoDuration(v.durationSeconds) } : {}),
  }));
}

/** ISO 8601 duration, e.g. 95 s → "PT1M35S". */
export function isoDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `PT${Math.floor(s / 60) ? `${Math.floor(s / 60)}M` : ""}${s % 60 || !Math.floor(s / 60) ? `${s % 60}S` : ""}`;
}

type JsonLd = Record<string, unknown>;

function lowestPrice(factSheet: FactSheet | null | undefined): { price: number; currency: string } | null {
  const tiers = factSheet?.pricing?.tiers.value ?? [];
  const priced = tiers.filter((t): t is typeof t & { price: number } => typeof t.price === "number");
  if (priced.length === 0) return factSheet?.pricing?.freePlan?.value ? { price: 0, currency: "USD" } : null;
  const min = priced.reduce((a, b) => (b.price < a.price ? b : a));
  return { price: min.price, currency: min.currency };
}

/**
 * Builds Product (SoftwareApplication) + Review, FAQPage and BreadcrumbList objects.
 * No AggregateRating: we publish one editorial rating, and SRS FR-CON-9 forbids invented counts.
 */
export function buildReviewStructuredData(input: ReviewStructuredDataInput): JsonLd[] {
  const out: JsonLd[] = [];
  const price = lowestPrice(input.factSheet);
  const review: JsonLd = {
    "@type": "Review",
    name: input.title,
    url: input.url,
    author: { "@type": "Person", name: input.author.name, url: input.author.url },
    publisher: { "@type": "Organization", name: input.siteName, url: input.siteUrl },
    ...(input.publishedAt ? { datePublished: input.publishedAt.toISOString() } : {}),
    dateModified: input.updatedAt.toISOString(),
    ...(input.score !== null
      ? { reviewRating: { "@type": "Rating", ratingValue: input.score, bestRating: 10, worstRating: 0 } }
      : {}),
  };
  out.push({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: input.product.name,
    url: input.product.websiteUrl,
    applicationCategory: input.product.category ?? "BusinessApplication",
    operatingSystem: (input.factSheet?.platforms?.value ?? ["Web"]).join(", ") || "Web",
    ...(input.product.logoUrl ? { image: input.product.logoUrl } : input.imageUrl ? { image: input.imageUrl } : {}),
    ...(price ? { offers: { "@type": "Offer", price: price.price, priceCurrency: price.currency } } : {}),
    review,
  });

  const faq = input.blocks.find((b) => b.type === "faq");
  if (faq && faq.type === "faq" && faq.items.length > 0) {
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.items.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: inlineText(item.answer) },
      })),
    });
  }

  out.push(...buildVideoStructuredData(input.videos ?? []));

  out.push({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: input.breadcrumbs.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: b.name,
      item: b.url,
    })),
  });
  return out;
}

/**
 * Checks the fields Google requires for review snippets, software apps, FAQ and breadcrumbs
 * (FR-CON-9 "validated before publish"). Returns human-readable problems; empty means valid.
 */
export function validateStructuredData(objects: JsonLd[]): string[] {
  const problems: string[] = [];
  const app = objects.find((o) => o["@type"] === "SoftwareApplication");
  if (!app) problems.push("Missing SoftwareApplication object");
  else {
    if (!app.name) problems.push("SoftwareApplication.name is required");
    const review = app.review as JsonLd | undefined;
    if (!review) problems.push("SoftwareApplication.review is required (no aggregateRating is published)");
    else {
      const rating = review.reviewRating as JsonLd | undefined;
      if (!rating || typeof rating.ratingValue !== "number")
        problems.push("Review.reviewRating.ratingValue is required");
      if (!(review.author as JsonLd | undefined)?.name) problems.push("Review.author.name is required");
    }
    const offers = app.offers as JsonLd | undefined;
    if (!offers || typeof offers.price !== "number") problems.push("SoftwareApplication.offers.price is required");
  }
  for (const faq of objects.filter((o) => o["@type"] === "FAQPage")) {
    const items = faq.mainEntity as JsonLd[];
    if (!items.length) problems.push("FAQPage.mainEntity is empty");
    for (const q of items) {
      if (!q.name || !(q.acceptedAnswer as JsonLd | undefined)?.text) problems.push("FAQ question without an answer");
    }
  }
  for (const video of objects.filter((o) => o["@type"] === "VideoObject")) {
    if (
      !video.name ||
      !video.description ||
      !video.uploadDate ||
      !(video.thumbnailUrl as unknown[] | undefined)?.length
    )
      problems.push("VideoObject needs name, description, thumbnailUrl and uploadDate");
  }
  const crumbs = objects.find((o) => o["@type"] === "BreadcrumbList");
  if (!crumbs || (crumbs.itemListElement as unknown[]).length === 0) problems.push("BreadcrumbList is missing");
  return problems;
}
