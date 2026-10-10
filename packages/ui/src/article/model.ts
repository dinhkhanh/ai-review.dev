import type { ArticleBody, Block, Inline } from "@repo/content";

/** Everything the renderer needs, already resolved to URLs (no DB types, mobile-portable shape). */
export interface RenderMedia {
  url: string;
  srcSet?: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

export interface RenderSource {
  id: string;
  url: string;
  title: string | null;
  kind: string;
  fetchedAt: string | Date;
}

export interface RenderModel {
  blocks: ArticleBody;
  media: Record<string, RenderMedia>;
  sources: RenderSource[];
  /** Product names (and internal review links) for comparison tables. */
  products: Record<string, { name: string; href?: string | null }>;
  /** Go-link href builder; defaults to /go/<slug>?p=<placement>. */
  goHref?: (slug: string, placement: string) => string;
  /** CTA targets that must bypass the redirect (programs that forbid cloaking, C-2). */
  directLinks?: Record<string, string>;
  /** "Report a change" link for pricing tables (FR-WEB-6). */
  reportHref?: string | null;
  disclosureHref?: string;
  /** Uploaded videos for `video` blocks, keyed by `videos.id` (FR-VID-4). */
  videos?: Record<string, RenderVideo>;
  /** BCP 47 tag for dates and prices, e.g. "de-DE" (phase 3 second locale). Defaults to "en-US". */
  intlLocale?: string;
  /** Content locale ("en", "de"); picks built-in labels and the date/price format. */
  locale?: string;
  /** UI string overrides; missing keys come from the locale's built-in labels, then English. */
  labels?: Partial<RenderLabels>;
}

/** Renderer UI strings (NFR-14: UI strings come from the app's message catalogue). */
export interface RenderLabels {
  verdict: string;
  ourVerdict: string;
  bestFor: string;
  notFor: string;
  pros: string;
  cons: string;
  feature: string;
  sources: string;
  retrieved: string;
  weight: string;
  pricesVerifiedOn: (date: string) => string;
  reportChange: string;
  watch: string;
  source: (n: number) => string;
  score: (score: string, band: string) => string;
  priceCustom: string;
  priceFree: string;
  period: Record<"month" | "year" | "one_time" | "usage" | "custom", string>;
  disclosureLead: string;
  disclosureBody: string;
  disclosureLink: string;
  /**
   * Marker appended to monetised links and CTA labels (German practice: "*" pointing at the
   * affiliate note). Empty in English, where rel="sponsored" and the disclosure suffice.
   */
  affiliateMarker: string;
  /** Advertising label shown with CTA buttons (German "Anzeige"); null for none. */
  adLabel: string | null;
}

export const DEFAULT_RENDER_LABELS: RenderLabels = {
  verdict: "Verdict",
  ourVerdict: "Our verdict",
  bestFor: "Best for",
  notFor: "Not for",
  pros: "Pros",
  cons: "Cons",
  feature: "Feature",
  sources: "Sources",
  retrieved: "retrieved",
  weight: "weight",
  pricesVerifiedOn: (date) => `Prices verified on ${date}.`,
  reportChange: "Report a change",
  watch: "Watch",
  source: (n) => `Source ${n}`,
  score: (score, band) => `Score ${score} out of 10 (${band})`,
  priceCustom: "Custom",
  priceFree: "Free",
  period: { month: "/month", year: "/year", one_time: " one-time", usage: " usage-based", custom: "" },
  disclosureLead: "Disclosure:",
  disclosureBody:
    "we may earn a commission if you buy through links on this page, at no extra cost to you. It never changes our verdict.",
  disclosureLink: "How we make money",
  affiliateMarker: "",
  adLabel: null,
};

/**
 * Built-in renderer labels per content locale, shared by the web app and the CMS preview so a
 * German article previews with German labels. German marks affiliate links with "*" and CTAs
 * with "Anzeige" (UWG § 5a, MStV § 22).
 */
export const RENDER_LABELS: Partial<Record<string, RenderLabels>> = {
  en: DEFAULT_RENDER_LABELS,
  de: {
    verdict: "Fazit",
    ourVerdict: "Unser Fazit",
    bestFor: "Ideal für",
    notFor: "Nicht ideal für",
    pros: "Vorteile",
    cons: "Nachteile",
    feature: "Merkmal",
    sources: "Quellen",
    retrieved: "abgerufen am",
    weight: "Gewichtung",
    pricesVerifiedOn: (date) => `Preise geprüft am ${date}.`,
    reportChange: "Änderung melden",
    watch: "Ansehen",
    source: (n) => `Quelle ${n}`,
    score: (score, band) => `Wertung ${score} von 10 (${band})`,
    priceCustom: "Auf Anfrage",
    priceFree: "Kostenlos",
    period: { month: "/Monat", year: "/Jahr", one_time: " einmalig", usage: " nutzungsabhängig", custom: "" },
    disclosureLead: "Hinweis:",
    disclosureBody:
      "Mit * gekennzeichnete Links sind Affiliate-Links (Werbung). Kaufen Sie darüber, erhalten wir eventuell eine Provision – für Sie ändert sich der Preis nicht. Unser Urteil beeinflusst das nie.",
    disclosureLink: "So finanzieren wir uns",
    affiliateMarker: "*",
    adLabel: "Anzeige",
  },
};

const INTL_LOCALE: Record<string, string> = { en: "en-US", de: "de-DE" };

export function renderLabels(model: Pick<RenderModel, "labels" | "locale">): RenderLabels {
  return { ...DEFAULT_RENDER_LABELS, ...(model.locale ? RENDER_LABELS[model.locale] : null), ...model.labels };
}

/** Intl tag for dates and prices: explicit `intlLocale`, else from `locale`, else en-US. */
export function renderIntlLocale(model: Pick<RenderModel, "intlLocale" | "locale">): string {
  return model.intlLocale ?? (model.locale ? INTL_LOCALE[model.locale] : undefined) ?? "en-US";
}

export interface RenderVideo {
  title: string;
  thumbnailUrl: string;
  watchUrl: string;
  vertical: boolean;
}

export function defaultGoHref(slug: string, placement: string) {
  return `/go/${encodeURIComponent(slug)}?p=${encodeURIComponent(placement)}`;
}

function inlinesOf(block: Block): Inline[][] {
  switch (block.type) {
    case "paragraph":
    case "callout":
      return [block.children];
    case "list":
      return block.items;
    case "faq":
      return block.items.map((i) => i.answer);
    default:
      return [];
  }
}

/** True when the article contains any monetised link (FR-AFF-14 disclosure trigger). */
export function hasMonetisedLinks(blocks: ArticleBody): boolean {
  return blocks.some(
    (b) => b.type === "cta" || inlinesOf(b).some((line) => line.some((s) => s.marks.some((m) => m.type === "golink"))),
  );
}

/** Source numbering by first citation, so footnote [1] is the first source cited. */
export function citationOrder(blocks: ArticleBody): string[] {
  const order: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.sourceId === "string" && !order.includes(obj.sourceId)) order.push(obj.sourceId);
      Object.values(obj).forEach(visit);
    }
  };
  visit(blocks);
  return order;
}

export function headingId(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "section"
  );
}

/** Table of contents from H2 headings. */
export function tableOfContents(blocks: ArticleBody) {
  return blocks.flatMap((b) =>
    b.type === "heading" && b.level === 2 ? [{ id: headingId(b.text), text: b.text }] : [],
  );
}
