import { canonicalOf, findTags, hreflangAlternates, jsonLdBlocks, metaContent, pathOf, titleOf } from "../html.ts";
import { result, type CheckResult, type FetchResult } from "../types.ts";
import { normalizeUrl } from "./web.ts";

type Json = Record<string, unknown>;

export type ReviewFacts = {
  goHrefs: string[];
  ogImage?: string;
  alternates: { hreflang: string; href: string }[];
};

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Flattens JSON-LD blocks (arrays and `@graph`) into a list of typed nodes. */
export function flattenJsonLd(blocks: unknown[]): Json[] {
  const out: Json[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (isObj(v)) {
      if (Array.isArray(v["@graph"])) visit(v["@graph"]);
      if (v["@type"]) out.push(v);
    }
  };
  blocks.forEach(visit);
  return out;
}

const hasType = (node: Json, type: string) =>
  Array.isArray(node["@type"]) ? (node["@type"] as unknown[]).includes(type) : node["@type"] === type;

/** Structured data per FR-CON-9: Product (SoftwareApplication) + Review with our rating only, FAQ, breadcrumbs. */
export function checkStructuredData(html: string, target: string): CheckResult[] {
  const ref = "FR-CON-9";
  const blocks = jsonLdBlocks(html);
  if (blocks.length === 0) return [result("review.jsonld", "fail", "no JSON-LD on the page", { ref, target })];
  const broken = blocks.filter((b) => b === null).length;
  if (broken) return [result("review.jsonld", "fail", `${broken} JSON-LD block(s) do not parse`, { ref, target })];
  const nodes = flattenJsonLd(blocks);
  const out: CheckResult[] = [];
  const problems: string[] = [];

  const product = nodes.find((n) => hasType(n, "SoftwareApplication") || hasType(n, "Product"));
  if (!product) problems.push("no SoftwareApplication/Product");
  else {
    if (!product.name) problems.push("product has no name");
    const review = isObj(product.review) ? product.review : nodes.find((n) => hasType(n, "Review"));
    const rating = review && isObj(review.reviewRating) ? review.reviewRating : undefined;
    if (!review) problems.push("no Review");
    else {
      if (!rating || typeof rating.ratingValue !== "number") problems.push("Review.reviewRating.ratingValue missing");
      if (!isObj(review.author) || !review.author.name) problems.push("Review.author.name missing");
    }
    const offers = isObj(product.offers) ? product.offers : undefined;
    if (!offers || offers.price === undefined) problems.push("offers.price missing");
  }
  out.push(
    problems.length
      ? result("review.jsonld", "fail", problems.join("; "), { ref, target })
      : result("review.jsonld", "pass", `${nodes.map((n) => n["@type"]).join(", ")}`, { ref, target }),
  );

  // Editorial rating only: no AggregateRating and no user-review counts (FR-CON-9 forbids fabricated counts).
  const raw = JSON.stringify(blocks);
  const fabricated = /"AggregateRating"|"aggregateRating"|"reviewCount"|"ratingCount"/.test(raw);
  out.push(
    fabricated
      ? result("review.rating-honest", "fail", "AggregateRating / review counts present", { ref, target })
      : result("review.rating-honest", "pass", "editorial rating only", { ref, target }),
  );

  const crumbs = nodes.find((n) => hasType(n, "BreadcrumbList"));
  const items = crumbs && Array.isArray(crumbs.itemListElement) ? crumbs.itemListElement.length : 0;
  out.push(
    items >= 2
      ? result("review.breadcrumbs", "pass", `${items} items`, { ref, target })
      : result("review.breadcrumbs", "fail", crumbs ? "BreadcrumbList has fewer than 2 items" : "no BreadcrumbList", {
          ref,
          target,
        }),
  );

  const faq = nodes.find((n) => hasType(n, "FAQPage"));
  const questions = faq && Array.isArray(faq.mainEntity) ? (faq.mainEntity as unknown[]) : [];
  const unanswered = questions.filter(
    (q) => !isObj(q) || !q.name || !isObj(q.acceptedAnswer) || !q.acceptedAnswer.text,
  );
  out.push(
    !faq
      ? result("review.faq", "warn", "no FAQPage (review has no FAQ block?)", { ref, target })
      : questions.length === 0 || unanswered.length
        ? result(
            "review.faq",
            "fail",
            `FAQPage with ${questions.length} question(s), ${unanswered.length} unanswered`,
            { ref, target },
          )
        : result("review.faq", "pass", `${questions.length} questions`, { ref, target }),
  );
  return out;
}

/** Title, description, canonical, robots and social tags (FR-WEB-4). */
export function checkSeoTags(html: string, url: string, res: FetchResult): CheckResult[] {
  const ref = "FR-WEB-4";
  const target = url;
  const out: CheckResult[] = [];
  const title = titleOf(html);
  const tl = title?.length ?? 0;
  out.push(
    !title
      ? result("review.title", "fail", "no <title>", { ref, target })
      : tl < 15 || tl > 70
        ? result("review.title", "warn", `title is ${tl} chars (aim for 15–70)`, { ref, target })
        : result("review.title", "pass", `${tl} chars`, { ref, target }),
  );
  const description = metaContent(html, "description");
  const dl = description?.length ?? 0;
  out.push(
    !description
      ? result("review.description", "fail", "no meta description", { ref, target })
      : dl < 50 || dl > 170
        ? result("review.description", "warn", `description is ${dl} chars (aim for 50–170)`, { ref, target })
        : result("review.description", "pass", `${dl} chars`, { ref, target }),
  );
  const canonical = canonicalOf(html);
  out.push(
    !canonical
      ? result("review.canonical", "fail", "no canonical", { ref, target })
      : normalizeUrl(canonical, url) !== normalizeUrl(url, url)
        ? result("review.canonical", "fail", `canonical points at ${canonical}`, { ref, target })
        : result("review.canonical", "pass", "self-canonical", { ref, target }),
  );
  const robots = `${metaContent(html, "robots") ?? ""} ${res.headers.get("x-robots-tag") ?? ""}`;
  out.push(
    /noindex/i.test(robots)
      ? result("review.indexable", "fail", `robots: ${robots.trim()}`, { ref, target })
      : result("review.indexable", "pass", "indexable", { ref, target }),
  );
  const missing = ["og:title", "og:description", "og:url", "og:image", "og:type", "twitter:card"].filter(
    (k) => !metaContent(html, k),
  );
  out.push(
    missing.length
      ? result("review.social", "fail", `missing ${missing.join(", ")}`, { ref, target })
      : result("review.social", "pass", `twitter:card ${metaContent(html, "twitter:card")}`, { ref, target }),
  );
  return out;
}

/** `role="note"` elements that link the affiliate policy (the AffiliateDisclosure component). */
export function disclosureNotes(html: string, url: string): { index: number }[] {
  const notes: { index: number }[] = [];
  for (const m of html.matchAll(/<(p|div|aside|section)\b[^>]*\brole=["']note["'][^>]*>/gi)) {
    const end = html.indexOf(`</${m[1]!.toLowerCase()}>`, m.index);
    const inner = html.slice(m.index, end === -1 ? undefined : end);
    const links = findTags(inner, "a").some((a) =>
      /\/affiliate-disclosure\/?$/.test(pathOf(a.attrs.href ?? "", url) ?? ""),
    );
    if (links) notes.push({ index: m.index });
  }
  return notes;
}

const GO = /^\/(?:[a-z]{2}\/)?go\//;

/** Disclosure before the first go-link, rel=sponsored on every go-link, AI disclosure, verified date. */
export function checkMonetisation(html: string, url: string): { results: CheckResult[]; goHrefs: string[] } {
  const target = url;
  const anchors = findTags(html, "a");
  const go = anchors.filter((a) => a.attrs.href && GO.test(pathOf(a.attrs.href, url) ?? ""));
  const goHrefs = go.map((a) => new URL(a.attrs.href!, url).toString());
  const out: CheckResult[] = [];
  const firstGo = go[0]?.index ?? Infinity;

  // FR-AFF-14: the affiliate disclosure (a note linking the policy page) renders above the first CTA.
  const disclosure = disclosureNotes(html, url)[0];
  if (go.length === 0)
    out.push(result("review.disclosure", "warn", "no go-links on the page", { ref: "FR-AFF-14", target }));
  else if (!disclosure || disclosure.index > firstGo)
    out.push(
      result("review.disclosure", "fail", "affiliate disclosure is not before the first go-link", {
        ref: "FR-AFF-14",
        target,
      }),
    );
  else
    out.push(
      result("review.disclosure", "pass", `disclosure before ${go.length} go-link(s)`, { ref: "FR-AFF-14", target }),
    );

  // FR-AFF-14 / FR-QA-5: monetised links carry rel="sponsored nofollow".
  const badRel = go.filter((a) => {
    const rel = (a.attrs.rel ?? "").toLowerCase().split(/\s+/);
    return !rel.includes("sponsored") || !rel.includes("nofollow");
  });
  if (go.length)
    out.push(
      badRel.length
        ? result(
            "review.rel-sponsored",
            "fail",
            `${badRel.length}/${go.length} go-links lack rel="sponsored nofollow", e.g. ${badRel[0]!.attrs.href}`,
            { ref: "FR-AFF-14", target },
          )
        : result("review.rel-sponsored", "pass", `${go.length} go-links`, { ref: "FR-AFF-14", target }),
    );

  // FR-CON-10: AI disclosure (configurable text) sits in the article header and links the editorial policy.
  const editorial = anchors.find((a) => /\/editorial-policy\/?$/.test(pathOf(a.attrs.href ?? "", url) ?? ""));
  const aiPhrase = /Researched with AI|with AI assistance|KI-Unterstützung/i.test(html);
  out.push(
    (editorial && editorial.index < firstGo) || aiPhrase
      ? result("review.ai-disclosure", "pass", "AI disclosure present", { ref: "FR-CON-10", target })
      : result("review.ai-disclosure", "fail", "no AI disclosure in the article header", { ref: "FR-CON-10", target }),
  );

  // FR-WEB-6 / FR-CON-10: "verified on <date>".
  const verified = /(Facts verified|Verified|Fakten geprüft am|Geprüft)(?:\s|<!-- -->)+[^<]{0,40}\d{4}/.test(html);
  out.push(
    verified
      ? result("review.verified-date", "pass", "last-verified date shown", { ref: "FR-WEB-6", target })
      : result("review.verified-date", "fail", "no last-verified date", { ref: "FR-WEB-6", target }),
  );
  return { results: out, goHrefs };
}

export function reviewFacts(html: string, url: string): Omit<ReviewFacts, "goHrefs"> {
  const og = metaContent(html, "og:image");
  return { ogImage: og ? new URL(og, url).toString() : undefined, alternates: hreflangAlternates(html) };
}

export function checkOgImage(res: FetchResult): CheckResult {
  const type = res.headers.get("content-type") ?? "";
  return res.status === 200 && type.startsWith("image/")
    ? result("review.og-image", "pass", `${type}, ${Math.round(res.body.length / 1024)} KB`, {
        ref: "FR-WEB-4",
        target: res.url,
      })
    : result("review.og-image", "fail", `HTTP ${res.status} ${type}`, { ref: "FR-WEB-4", target: res.url });
}

/**
 * hreflang (Phase 3 i18n, FR-WEB-4): when alternates exist they include x-default and the page
 * itself, and every alternate links back. `others` maps each alternate URL to its alternates.
 */
export function checkHreflang(
  url: string,
  own: { hreflang: string; href: string }[],
  others: Map<string, { hreflang: string; href: string }[] | null>,
): CheckResult {
  const ref = "FR-WEB-4 hreflang";
  if (own.length === 0)
    return result("review.hreflang", "pass", "single-locale page (no alternates)", { ref, target: url });
  const self = normalizeUrl(url, url);
  const problems: string[] = [];
  if (!own.some((a) => a.hreflang.toLowerCase() === "x-default")) problems.push("no x-default");
  if (!own.some((a) => normalizeUrl(a.href, url) === self)) problems.push("no self-reference");
  for (const [alt, theirs] of others) {
    if (theirs === null) problems.push(`${alt} did not load`);
    else if (!theirs.some((a) => normalizeUrl(a.href, alt) === self)) problems.push(`${alt} does not link back`);
  }
  return problems.length
    ? result("review.hreflang", "fail", problems.join("; "), { ref, target: url })
    : result("review.hreflang", "pass", `${own.map((a) => a.hreflang).join(", ")} reciprocal`, { ref, target: url });
}
