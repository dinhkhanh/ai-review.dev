import type { ArticleBody } from "./blocks";
import { inlineText } from "./inline-markdown";

/** JSON-LD inputs for comparisons, alternatives and best-of lists (FR-CON-9, FR-CON-8). */
export interface ListStructuredDataInput {
  siteUrl: string;
  siteName: string;
  url: string;
  title: string;
  description: string;
  publishedAt: Date | null;
  updatedAt: Date;
  imageUrl?: string | null;
  author: { name: string; url: string };
  /** Products in the order the article presents them; `url` is our review page or the vendor site. */
  items: Array<{ name: string; url: string }>;
  blocks: ArticleBody;
  breadcrumbs: Array<{ name: string; url: string }>;
}

type JsonLd = Record<string, unknown>;

/**
 * Article + ItemList (+ FAQPage, BreadcrumbList). No ratings or review markup: list pages are
 * editorial comparisons, and each product's own review page carries its Review markup.
 */
export function buildListStructuredData(input: ListStructuredDataInput): JsonLd[] {
  const out: JsonLd[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: input.title,
      description: input.description,
      url: input.url,
      ...(input.imageUrl ? { image: input.imageUrl } : {}),
      author: { "@type": "Person", name: input.author.name, url: input.author.url },
      publisher: { "@type": "Organization", name: input.siteName, url: input.siteUrl },
      ...(input.publishedAt ? { datePublished: input.publishedAt.toISOString() } : {}),
      dateModified: input.updatedAt.toISOString(),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: input.title,
      itemListElement: input.items.map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: { "@type": "SoftwareApplication", name: item.name, url: item.url },
      })),
    },
  ];
  const faq = input.blocks.find((b) => b.type === "faq");
  if (faq?.type === "faq" && faq.items.length > 0) {
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

export function validateListStructuredData(objects: JsonLd[]): string[] {
  const problems: string[] = [];
  const article = objects.find((o) => o["@type"] === "Article");
  if (!article?.headline) problems.push("Article.headline is required");
  if (!(article?.author as JsonLd | undefined)?.name) problems.push("Article.author.name is required");
  const list = objects.find((o) => o["@type"] === "ItemList");
  const items = (list?.itemListElement as JsonLd[] | undefined) ?? [];
  if (items.length < 2) problems.push("ItemList needs at least two products");
  if (items.some((i) => !((i.item as JsonLd | undefined)?.name && (i.item as JsonLd).url)))
    problems.push("Every ItemList entry needs a name and URL");
  for (const faq of objects.filter((o) => o["@type"] === "FAQPage")) {
    for (const q of faq.mainEntity as JsonLd[]) {
      if (!q.name || !(q.acceptedAnswer as JsonLd | undefined)?.text) problems.push("FAQ question without an answer");
    }
  }
  const crumbs = objects.find((o) => o["@type"] === "BreadcrumbList");
  if (!crumbs || (crumbs.itemListElement as unknown[]).length === 0) problems.push("BreadcrumbList is missing");
  return problems;
}
