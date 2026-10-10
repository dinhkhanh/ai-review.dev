import { createHash } from "node:crypto";
import { localizedArticlePath, type ArticleBody, type ContentLocale } from "@repo/content";
import {
  and,
  articles,
  articleVersions,
  asc,
  count,
  deals,
  desc,
  eq,
  goSlugs,
  inArray,
  isNull,
  ne,
  newsletterDeliveries,
  newsletterIssues,
  newsletterSubscribers,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { DomainError } from "./errors";
import { newsletterEnvFromProcess, newsletterLocale, newsletterPageUrl, type NewsletterEnv } from "./newsletter";
import { notify } from "./notifications";
import { getSetting } from "./settings";

/**
 * Weekly newsletter digest (FR-WEB-9). One issue per locale per Monday–Sunday period, built from
 * articles first published in the period ("new") and refreshed articles whose new published version
 * has not been featured yet ("updated"), plus active deals. Items are a snapshot: the CMS can edit
 * subject, intro and item order before sending, and later article edits do not change a sent issue.
 *
 * Sending is idempotent per subscriber: a `newsletter_deliveries` row is claimed before each email,
 * so a crashed or repeated send never emails anyone twice (see `sendDigestIssue`).
 */

export type DigestArticleItem = {
  kind: "new" | "updated";
  articleId: string;
  versionId: string;
  type: "review" | "comparison" | "alternatives" | "best_of";
  title: string;
  summary: string | null;
  score: number | null;
  url: string;
  productName: string | null;
  /** Go-link with placement `newsletter`; reviews only. */
  ctaUrl: string | null;
};
export type DigestDealItem = {
  kind: "deal";
  dealId: string;
  title: string;
  productName: string;
  discountText: string | null;
  code: string | null;
  ctaUrl: string;
  endsAt: string | null;
};
export type DigestItem = DigestArticleItem | DigestDealItem;

export type DigestIssue = typeof newsletterIssues.$inferSelect;

/** Deals are extras: an issue with only deals is not worth an email. */
export const isArticleItem = (item: DigestItem): item is DigestArticleItem => item.kind !== "deal";
const MAX_DEALS = 5;
/** Resend's batch endpoint takes at most 100 emails per call. */
export const DIGEST_BATCH_SIZE = 100;
/** Resend keeps idempotency keys for 24 h; older interrupted batches cannot be retried safely. */
const IDEMPOTENCY_WINDOW_MS = 23 * 3600 * 1000;

const dayMs = 24 * 3600 * 1000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The Monday–Sunday week before `now` (UTC), as inclusive ISO dates. */
export function previousDigestPeriod(now: Date): { periodStart: string; periodEnd: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const thisMonday = today - sinceMonday * dayMs;
  return { periodStart: isoDay(new Date(thisMonday - 7 * dayMs)), periodEnd: isoDay(new Date(thisMonday - dayMs)) };
}

function periodBounds(periodStart: string, periodEnd: string) {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(new Date(`${periodEnd}T00:00:00Z`).getTime() + dayMs);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new DomainError("invalid", "Invalid digest period");
  }
  return { start, end };
}

const COPY = {
  en: {
    heading: "New and updated reviews",
    new: "New",
    updated: "Updated",
    read: "Read the review",
    readGuide: "Read more",
    visit: (p: string) => `Visit ${p}`,
    deals: "Deals and trials",
    code: "Code",
    until: "until",
    score: "Score",
    disclosure:
      "Some links are affiliate links: if you buy through them we may earn a commission, at no extra cost to you. It never changes our verdicts.",
    footer: (site: string) => `You get this email because you subscribed at ${site}.`,
    unsubscribe: "Unsubscribe",
    preheader: (n: number) => `${n} new and updated ${n === 1 ? "review" : "reviews"} this week`,
    subject: (titles: string[], n: number) =>
      n === 1
        ? `New this week: ${titles[0]}`
        : `New this week: ${titles.slice(0, 2).join(", ")}${n > 2 ? " and more" : ""}`,
  },
  de: {
    heading: "Neue und aktualisierte Testberichte",
    new: "Neu",
    updated: "Aktualisiert",
    read: "Zum Testbericht",
    readGuide: "Weiterlesen",
    visit: (p: string) => `Zu ${p}*`,
    deals: "Angebote und Testphasen",
    code: "Code",
    until: "bis",
    score: "Bewertung",
    disclosure:
      "Werbehinweis: Mit * markierte Links sind Affiliate-Links. Kaufst du darüber, erhalten wir eventuell eine Provision – für dich ändert sich der Preis nicht. Unsere Bewertungen beeinflusst das nicht.",
    footer: (site: string) => `Du erhältst diese E-Mail, weil du dich bei ${site} angemeldet hast.`,
    unsubscribe: "Abmelden",
    preheader: (n: number) => `${n} neue und aktualisierte ${n === 1 ? "Testbericht" : "Testberichte"} diese Woche`,
    subject: (titles: string[], n: number) =>
      n === 1
        ? `Neu diese Woche: ${titles[0]}`
        : `Neu diese Woche: ${titles.slice(0, 2).join(", ")}${n > 2 ? " und mehr" : ""}`,
  },
} satisfies Record<ContentLocale, unknown>;

const copyFor = (locale: string) => COPY[newsletterLocale(locale)];

export function defaultDigestSubject(locale: string, items: DigestItem[]): string {
  const titles = items.filter(isArticleItem).map((i) => i.productName ?? i.title);
  return copyFor(locale).subject(titles, titles.length).slice(0, 150);
}

function withUtm(url: string, campaign: string): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", "newsletter");
  u.searchParams.set("utm_medium", "email");
  u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}

const goUrl = (siteUrl: string, slug: string, articleSlug: string | null) =>
  `${siteUrl}/go/${encodeURIComponent(slug)}?p=newsletter${articleSlug ? `&a=${encodeURIComponent(articleSlug)}` : ""}`;

/** Verdict summary for reviews, otherwise the SEO description; one line, trimmed. */
export function digestSummary(blocks: ArticleBody | null | undefined, metaDescription: string | null): string | null {
  const verdict = blocks?.find((b) => b.type === "verdict");
  const text = (verdict && "summary" in verdict ? verdict.summary : null) || metaDescription;
  if (!text) return null;
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 220 ? `${line.slice(0, 217).trimEnd()}…` : line;
}

/** Article versions already featured in earlier issues of this locale. */
async function featuredVersionIds(db: DbOrTx, locale: string, beforePeriod: string): Promise<Set<string>> {
  const rows = await db
    .select({ items: newsletterIssues.items })
    .from(newsletterIssues)
    .where(and(eq(newsletterIssues.locale, locale), sql`${newsletterIssues.periodStart} < ${beforePeriod}`));
  return new Set(
    rows.flatMap((r) => r.items.map((i) => i.versionId).filter((v): v is string => typeof v === "string")),
  );
}

/**
 * Digest entries for one locale and period. "Updated" means a refreshed article (version > 1,
 * first published before the period) whose current published version was created in the 30 days
 * before the period end and has not been featured in an earlier issue: a refresh approved a week
 * after it was written still makes the next digest, exactly once.
 */
export async function collectDigestItems(
  db: DbOrTx,
  input: { locale: string; periodStart: string; periodEnd: string; maxItems: number; siteUrl: string },
): Promise<DigestItem[]> {
  const { start, end } = periodBounds(input.periodStart, input.periodEnd);
  const campaign = `digest-${input.periodStart}`;
  const featured = await featuredVersionIds(db, input.locale, input.periodStart);
  const rows = await db
    .select({
      articleId: articles.id,
      versionId: articleVersions.id,
      version: articleVersions.version,
      versionCreatedAt: articleVersions.createdAt,
      type: articles.type,
      slug: articles.slug,
      title: articles.title,
      publishedAt: articles.publishedAt,
      score: articleVersions.overallScore,
      blocks: articleVersions.blocks,
      metaDescription: sql<string | null>`${articleVersions.seo} ->> 'metaDescription'`,
      productName: products.name,
      goSlug: sql<
        string | null
      >`(select ${goSlugs.slug} from ${goSlugs} where ${goSlugs.productId} = ${products.id} order by ${goSlugs.createdAt} limit 1)`,
    })
    .from(articles)
    .innerJoin(articleVersions, eq(articleVersions.id, articles.publishedVersionId))
    .leftJoin(products, eq(products.id, articles.productId))
    .where(
      and(
        eq(articles.locale, input.locale),
        ne(articles.status, "archived"),
        sql`${articles.publishedAt} < ${end.toISOString()}::timestamptz`,
        sql`(${articles.publishedAt} >= ${start.toISOString()}::timestamptz or (${articleVersions.version} > 1 and ${articleVersions.createdAt} >= ${new Date(end.getTime() - 30 * dayMs).toISOString()}::timestamptz and ${articleVersions.createdAt} < ${end.toISOString()}::timestamptz))`,
      ),
    )
    .orderBy(desc(articles.publishedAt));

  const items: DigestArticleItem[] = rows
    .filter((r) => !featured.has(r.versionId))
    .map((r) => {
      const isNew = !!r.publishedAt && r.publishedAt >= start;
      return {
        kind: isNew ? ("new" as const) : ("updated" as const),
        articleId: r.articleId,
        versionId: r.versionId,
        type: r.type,
        title: r.title,
        summary: digestSummary(r.blocks, r.metaDescription),
        score: r.type === "review" ? r.score : null,
        url: withUtm(`${input.siteUrl}${localizedArticlePath(r.type, r.slug, input.locale)}`, campaign),
        productName: r.productName,
        ctaUrl: r.type === "review" && r.goSlug ? goUrl(input.siteUrl, r.goSlug, r.slug) : null,
      };
    })
    // New before updated, then newest first (rows are already newest first).
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "new" ? -1 : 1))
    .slice(0, input.maxItems);
  if (items.length === 0) return [];
  return [...items, ...(await digestDeals(db, input.locale, input.siteUrl, end))];
}

/** Active deals for products with a live review in this locale (so every deal has a page behind it). */
async function digestDeals(db: DbOrTx, locale: string, siteUrl: string, at: Date): Promise<DigestDealItem[]> {
  const rows = await db
    .select({
      id: deals.id,
      title: deals.title,
      discountText: deals.discountText,
      code: deals.code,
      endsAt: deals.endsAt,
      productName: products.name,
      reviewSlug: articles.slug,
      goSlug: sql<
        string | null
      >`(select ${goSlugs.slug} from ${goSlugs} where ${goSlugs.productId} = ${products.id} order by ${goSlugs.createdAt} limit 1)`,
    })
    .from(deals)
    .innerJoin(products, eq(products.id, deals.productId))
    .innerJoin(
      articles,
      and(
        eq(articles.productId, products.id),
        eq(articles.type, "review"),
        eq(articles.locale, locale),
        sql`${articles.publishedVersionId} is not null`,
        ne(articles.status, "archived"),
      ),
    )
    .where(
      and(
        eq(deals.active, true),
        sql`(${deals.startsAt} is null or ${deals.startsAt} <= ${at.toISOString()}::timestamptz)`,
        sql`(${deals.endsAt} is null or ${deals.endsAt} > ${at.toISOString()}::timestamptz)`,
      ),
    )
    .orderBy(asc(deals.position), asc(products.name))
    .limit(MAX_DEALS * 2);
  return rows
    .flatMap((r) =>
      r.goSlug
        ? [
            {
              kind: "deal" as const,
              dealId: r.id,
              title: r.title,
              productName: r.productName,
              discountText: r.discountText,
              code: r.code,
              ctaUrl: goUrl(siteUrl, r.goSlug, r.reviewSlug),
              endsAt: r.endsAt?.toISOString() ?? null,
            },
          ]
        : [],
    )
    .slice(0, MAX_DEALS);
}

/**
 * Builds (or returns the existing) issue for a locale and period. Returns null when nothing new
 * was published, so empty digests are never created. `rebuild` refreshes the items of a draft.
 */
export async function buildDigestIssue(
  db: DbOrTx,
  input: {
    locale: string;
    periodStart?: string;
    periodEnd?: string;
    now?: Date;
    maxItems?: number;
    rebuild?: boolean;
    createdByUserId?: string | null;
    env?: Pick<NewsletterEnv, "siteUrl">;
  },
): Promise<{ issue: DigestIssue; created: boolean } | null> {
  const locale = newsletterLocale(input.locale);
  const period =
    input.periodStart && input.periodEnd
      ? { periodStart: input.periodStart, periodEnd: input.periodEnd }
      : previousDigestPeriod(input.now ?? new Date());
  const [existing] = await db
    .select()
    .from(newsletterIssues)
    .where(and(eq(newsletterIssues.locale, locale), eq(newsletterIssues.periodStart, period.periodStart)))
    .limit(1);
  if (existing && !(input.rebuild && existing.status === "draft")) return { issue: existing, created: false };

  const maxItems = input.maxItems ?? (await getSetting(db, "newsletter.digest"))?.maxItems ?? 8;
  const siteUrl = (input.env ?? newsletterEnvFromProcess()).siteUrl;
  const items = await collectDigestItems(db, { locale, ...period, maxItems, siteUrl });
  if (!items.some(isArticleItem)) return existing ? { issue: existing, created: false } : null;
  const subject = defaultDigestSubject(locale, items);
  if (existing) {
    const [issue] = await db
      .update(newsletterIssues)
      .set({ items, subject })
      .where(eq(newsletterIssues.id, existing.id))
      .returning();
    return { issue: issue!, created: false };
  }
  const [issue] = await db
    .insert(newsletterIssues)
    .values({ locale, ...period, subject, items, createdByUserId: input.createdByUserId ?? null })
    .onConflictDoNothing({ target: [newsletterIssues.locale, newsletterIssues.periodStart] })
    .returning();
  if (!issue) {
    // Built concurrently by another run.
    const [row] = await db
      .select()
      .from(newsletterIssues)
      .where(and(eq(newsletterIssues.locale, locale), eq(newsletterIssues.periodStart, period.periodStart)))
      .limit(1);
    return { issue: row!, created: false };
  }
  return { issue, created: true };
}

export async function getDigestIssue(db: DbOrTx, id: string): Promise<DigestIssue | null> {
  const [row] = await db.select().from(newsletterIssues).where(eq(newsletterIssues.id, id)).limit(1);
  return row ?? null;
}

export async function listDigestIssues(db: DbOrTx, opts: { limit?: number } = {}) {
  return db
    .select()
    .from(newsletterIssues)
    .orderBy(desc(newsletterIssues.periodStart), asc(newsletterIssues.locale))
    .limit(Math.min(opts.limit ?? 50, 200));
}

const EDITABLE: DigestIssue["status"][] = ["draft", "scheduled", "failed"];

function assertEditable(issue: DigestIssue | null): asserts issue is DigestIssue {
  if (!issue) throw new DomainError("not_found", "Issue not found");
  if (!EDITABLE.includes(issue.status)) {
    throw new DomainError("conflict", `A ${issue.status} issue cannot be changed`);
  }
}

/**
 * CMS edits: subject, intro and the item list (`itemKeys` = the kept items in their new order, by
 * `articleId` or `dealId`). Items cannot be added here; rebuild the draft to pick up new articles.
 */
export async function updateDigestIssue(
  db: DbOrTx,
  id: string,
  patch: { subject?: string; intro?: string | null; itemKeys?: string[] },
): Promise<DigestIssue> {
  const issue = await getDigestIssue(db, id);
  assertEditable(issue);
  const set: Partial<typeof newsletterIssues.$inferInsert> = {};
  if (patch.subject !== undefined) {
    const subject = patch.subject.replace(/\s+/g, " ").trim();
    if (!subject || subject.length > 150) throw new DomainError("invalid", "Subject must be 1–150 characters");
    set.subject = subject;
  }
  if (patch.intro !== undefined) {
    const intro = patch.intro?.trim() ?? "";
    if (intro.length > 2000) throw new DomainError("invalid", "Intro must be at most 2000 characters");
    set.intro = intro || null;
  }
  if (patch.itemKeys) {
    const byKey = new Map(issue.items.map((i) => [itemKey(i as DigestItem), i]));
    const items = patch.itemKeys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
    if (!items.some((i) => isArticleItem(i as DigestItem))) {
      throw new DomainError("invalid", "Keep at least one article in the issue");
    }
    set.items = items;
  }
  const [row] = await db.update(newsletterIssues).set(set).where(eq(newsletterIssues.id, id)).returning();
  return row!;
}

export const itemKey = (item: DigestItem) => (item.kind === "deal" ? item.dealId : item.articleId);

/** Schedules an issue (the hourly worker sends it once due) or unschedules it back to a draft. */
export async function scheduleDigestIssue(db: DbOrTx, id: string, at: Date | null, now = new Date()) {
  const issue = await getDigestIssue(db, id);
  assertEditable(issue);
  if (at && at.getTime() < now.getTime() - 60_000) throw new DomainError("invalid", "Pick a time in the future");
  const [row] = await db
    .update(newsletterIssues)
    .set(at ? { status: "scheduled", scheduledFor: at } : { status: "draft", scheduledFor: null })
    .where(eq(newsletterIssues.id, id))
    .returning();
  return row!;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface DigestRenderOptions {
  siteUrl: string;
  siteName?: string;
  /** Visitor-facing unsubscribe page for this recipient. */
  unsubscribeUrl: string;
}

/**
 * Renders one issue as HTML + text. Table layout with inline styles for mail clients; colours are
 * mid-contrast so clients that invert for dark mode stay readable, and `color-scheme` lets the
 * others pick their own background. Every affiliate CTA is a go-link (placement `newsletter`).
 */
export function renderDigestEmail(
  issue: Pick<DigestIssue, "locale" | "subject" | "intro" | "items">,
  opts: DigestRenderOptions,
): { subject: string; html: string; text: string } {
  const t = copyFor(issue.locale);
  const site = opts.siteName ?? "AI Review";
  const items = issue.items as DigestItem[];
  const articleItems = items.filter(isArticleItem);
  const dealItems = items.filter((i): i is DigestDealItem => i.kind === "deal");
  const lang = newsletterLocale(issue.locale);
  const introParas = (issue.intro ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:8px 8px 0 0;padding:8px 14px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;${
      primary ? "background:#2563eb;color:#ffffff;" : "border:1px solid #9ca3af;color:#1d4ed8;"
    }"${primary ? "" : ' rel="sponsored"'}>${esc(label)}</a>`;

  const articleHtml = articleItems
    .map((i) => {
      const badge = i.kind === "new" ? t.new : t.updated;
      const score = i.score != null ? ` · ${t.score} ${i.score.toFixed(1)}/10` : "";
      return `<tr><td style="padding:16px 0;border-top:1px solid #d1d5db;">
<p style="margin:0;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;">${esc(badge)}${esc(score)}</p>
<h2 style="margin:4px 0 0;font-size:18px;line-height:1.3;"><a href="${esc(i.url)}" style="color:#111827;text-decoration:none;">${esc(i.title)}</a></h2>
${i.summary ? `<p style="margin:6px 0 0;font-size:15px;line-height:1.5;color:#374151;">${esc(i.summary)}</p>` : ""}
<p style="margin:4px 0 0;">${button(i.url, i.type === "review" ? t.read : t.readGuide, true)}${
        i.ctaUrl && i.productName ? button(i.ctaUrl, t.visit(i.productName), false) : ""
      }</p>
</td></tr>`;
    })
    .join("\n");

  const dealsHtml = dealItems.length
    ? `<tr><td style="padding:16px 0 0;border-top:1px solid #d1d5db;"><h2 style="margin:0;font-size:16px;">${esc(t.deals)}</h2><ul style="margin:8px 0 0;padding-left:20px;font-size:15px;line-height:1.6;color:#374151;">${dealItems
        .map(
          (d) =>
            `<li><a href="${esc(d.ctaUrl)}" rel="sponsored" style="color:#1d4ed8;">${esc(d.productName)}${lang === "de" ? "*" : ""}</a>: ${esc(d.discountText ?? d.title)}${
              d.code ? ` · ${esc(t.code)} <code style="font-family:monospace;">${esc(d.code)}</code>` : ""
            }${d.endsAt ? ` (${esc(t.until)} ${esc(d.endsAt.slice(0, 10))})` : ""}</li>`,
        )
        .join("")}</ul></td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(issue.subject)}</title></head>
<body style="margin:0;padding:0;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(t.preheader(articleItems.length))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding-bottom:8px;"><a href="${esc(opts.siteUrl)}" style="font-size:14px;font-weight:700;color:#2563eb;text-decoration:none;">${esc(site)}</a></td></tr>
<tr><td><h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;">${esc(t.heading)}</h1>${introParas
    .map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#374151;">${esc(p)}</p>`)
    .join("")}</td></tr>
${articleHtml}
${dealsHtml}
<tr><td style="padding:24px 0 0;border-top:1px solid #d1d5db;font-size:12px;line-height:1.5;color:#6b7280;">
<p style="margin:0 0 8px;">${esc(t.disclosure)}</p>
<p style="margin:0;">${esc(t.footer(site))} <a href="${esc(opts.unsubscribeUrl)}" style="color:#6b7280;">${esc(t.unsubscribe)}</a></p>
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    t.heading,
    "",
    ...introParas.flatMap((p) => [p, ""]),
    ...articleItems.flatMap((i) => [
      `${i.kind === "new" ? t.new : t.updated}: ${i.title}${i.score != null ? ` (${i.score.toFixed(1)}/10)` : ""}`,
      ...(i.summary ? [i.summary] : []),
      i.url,
      ...(i.ctaUrl && i.productName ? [`${t.visit(i.productName)}: ${i.ctaUrl}`] : []),
      "",
    ]),
    ...(dealItems.length
      ? [
          t.deals,
          ...dealItems.map(
            (d) =>
              `- ${d.productName}${lang === "de" ? "*" : ""}: ${d.discountText ?? d.title}${d.code ? ` (${t.code} ${d.code})` : ""} ${d.ctaUrl}`,
          ),
          "",
        ]
      : []),
    "--",
    t.disclosure,
    `${t.footer(site)} ${t.unsubscribe}: ${opts.unsubscribeUrl}`,
  ].join("\n");

  return { subject: issue.subject, html, text };
}

/** RFC 2369 / RFC 8058 headers: mail clients show "Unsubscribe" and POST one-click requests. */
export function listUnsubscribeHeaders(siteUrl: string, token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${siteUrl}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

export interface DigestSendOptions {
  env?: NewsletterEnv;
  fetch?: typeof fetch;
  now?: Date;
  batchSize?: number;
  /** Pause between batches (Resend rate limit); 0 in tests. */
  pauseMs?: number;
}

export interface DigestSendResult {
  status: DigestIssue["status"];
  delivered: number;
  failed: number;
  pending: number;
  message: string;
}

function assertCanSend(env: NewsletterEnv) {
  if (!env.resendApiKey || !env.emailFrom) {
    throw new DomainError("invalid", "Sending is off: set RESEND_API_KEY and NOTIFY_EMAIL_FROM (a verified sender)");
  }
}

const eligibleSubscribers = (locale: string) =>
  and(
    eq(newsletterSubscribers.locale, locale),
    sql`${newsletterSubscribers.confirmedAt} is not null`,
    isNull(newsletterSubscribers.unsubscribedAt),
    sql`${newsletterSubscribers.token} is not null`,
  );

const batchKey = (issueId: string, subscriberIds: string[]) =>
  createHash("sha256")
    .update(`${issueId}:${[...subscriberIds].sort().join(",")}`)
    .digest("hex")
    .slice(0, 32);

type Recipient = { deliveryId: string; subscriberId: string; email: string; token: string };

type BatchOutcome =
  { kind: "sent"; ids: string[] } | { kind: "failed"; error: string } | { kind: "unknown"; error: string };

/**
 * POSTs one batch to Resend with an idempotency key derived from the recipients, so retrying the
 * same batch (after a timeout or crash) within 24 h never sends twice. 429/5xx are retried; other
 * HTTP errors fail the batch; network errors leave its outcome unknown (the batch stays pending).
 */
async function postBatch(
  env: NewsletterEnv,
  key: string,
  emails: Array<Record<string, unknown>>,
  fetchImpl: typeof fetch,
): Promise<BatchOutcome> {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify(emails),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      return { kind: "unknown", error: `network: ${String(error).slice(0, 200)}` };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
      return { kind: "sent", ids: emails.map((_, i) => body.data?.[i]?.id ?? "") };
    }
    lastError = `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
    if (res.status !== 429 && res.status < 500) return { kind: "failed", error: lastError };
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return { kind: "failed", error: lastError };
}

async function deliverBatch(
  db: DbOrTx,
  issue: DigestIssue,
  recipients: Recipient[],
  key: string,
  env: NewsletterEnv,
  fetchImpl: typeof fetch,
): Promise<BatchOutcome> {
  const emails = recipients.map((r) => {
    const message = renderDigestEmail(issue, {
      siteUrl: env.siteUrl,
      siteName: env.siteName,
      unsubscribeUrl: newsletterPageUrl(env, issue.locale, "unsubscribe", r.token),
    });
    return {
      from: env.emailFrom,
      to: [r.email],
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: listUnsubscribeHeaders(env.siteUrl, r.token),
      tags: [{ name: "category", value: "digest" }],
    };
  });
  const outcome = await postBatch(env, `digest/${issue.id}/${key}`, emails, fetchImpl);
  if (outcome.kind === "sent") {
    for (const [i, r] of recipients.entries()) {
      await db
        .update(newsletterDeliveries)
        .set({ status: "sent", providerId: outcome.ids[i] || null, error: null })
        .where(eq(newsletterDeliveries.id, r.deliveryId));
    }
    await db
      .update(newsletterSubscribers)
      .set({ lastIssueId: issue.id })
      .where(
        inArray(
          newsletterSubscribers.id,
          recipients.map((r) => r.subscriberId),
        ),
      );
  } else if (outcome.kind === "failed") {
    await db
      .update(newsletterDeliveries)
      .set({ status: "failed", error: outcome.error })
      .where(
        inArray(
          newsletterDeliveries.id,
          recipients.map((r) => r.deliveryId),
        ),
      );
  }
  return outcome;
}

export async function digestDeliveryCounts(db: DbOrTx, issueId: string) {
  const rows = await db
    .select({ status: newsletterDeliveries.status, n: count() })
    .from(newsletterDeliveries)
    .where(eq(newsletterDeliveries.issueId, issueId))
    .groupBy(newsletterDeliveries.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return { sent: by.sent ?? 0, failed: by.failed ?? 0, pending: by.pending ?? 0 };
}

/**
 * Sends an issue to every confirmed subscriber of its locale. Each recipient is claimed with a
 * `pending` delivery row (unique per issue + subscriber) before the batch goes out, so concurrent or
 * repeated runs never email anyone twice. Interrupted batches are retried with the same idempotency
 * key within Resend's 24 h window and marked failed after it. Safe to call again to resume.
 */
export async function sendDigestIssue(
  db: DbOrTx,
  issueId: string,
  opts: DigestSendOptions = {},
): Promise<DigestSendResult> {
  const env = opts.env ?? newsletterEnvFromProcess();
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? new Date();
  const batchSize = Math.min(opts.batchSize ?? DIGEST_BATCH_SIZE, DIGEST_BATCH_SIZE);
  const pause = () => (opts.pauseMs ?? 600) > 0 && new Promise((r) => setTimeout(r, opts.pauseMs ?? 600));
  assertCanSend(env);

  const existing = await getDigestIssue(db, issueId);
  if (!existing) throw new DomainError("not_found", "Issue not found");
  if (existing.status === "sent") {
    return {
      status: "sent",
      ...(await digestDeliveryCounts(db, issueId)),
      delivered: existing.delivered,
      message: "Already sent",
    };
  }
  if (!(existing.items as DigestItem[]).some(isArticleItem)) {
    throw new DomainError("invalid", "This issue has no articles; nothing to send");
  }
  const [claimed] = await db
    .update(newsletterIssues)
    .set({ status: "sending", error: null })
    .where(
      and(
        eq(newsletterIssues.id, issueId),
        inArray(newsletterIssues.status, ["draft", "scheduled", "failed", "sending"]),
      ),
    )
    .returning();
  if (!claimed) throw new DomainError("conflict", "The issue changed while sending started; reload");
  const issue = claimed;
  const [{ n: total } = { n: 0 }] = await db
    .select({ n: count() })
    .from(newsletterSubscribers)
    .where(eligibleSubscribers(issue.locale));
  const delivered = await digestDeliveryCounts(db, issueId);
  await db
    .update(newsletterIssues)
    .set({ recipients: Math.max(Number(total), delivered.sent + delivered.failed + delivered.pending) })
    .where(eq(newsletterIssues.id, issueId));

  let interrupted: string | null = null;

  // 1. Resume batches a previous run claimed but did not finish.
  const pendingRows = await db
    .select({
      deliveryId: newsletterDeliveries.id,
      subscriberId: newsletterDeliveries.subscriberId,
      providerId: newsletterDeliveries.providerId,
      createdAt: newsletterDeliveries.createdAt,
      email: newsletterSubscribers.email,
      token: newsletterSubscribers.token,
    })
    .from(newsletterDeliveries)
    .innerJoin(newsletterSubscribers, eq(newsletterSubscribers.id, newsletterDeliveries.subscriberId))
    .where(and(eq(newsletterDeliveries.issueId, issueId), eq(newsletterDeliveries.status, "pending")));
  const pendingBatches = new Map<string, typeof pendingRows>();
  for (const row of pendingRows) {
    const key = row.providerId?.replace(/^batch:/, "") ?? "unknown";
    pendingBatches.set(key, [...(pendingBatches.get(key) ?? []), row]);
  }
  for (const [key, rows] of pendingBatches) {
    if (key === "unknown" || now.getTime() - rows[0]!.createdAt.getTime() > IDEMPOTENCY_WINDOW_MS) {
      await db
        .update(newsletterDeliveries)
        .set({ status: "failed", error: "Send was interrupted; outcome unknown, not retried" })
        .where(
          inArray(
            newsletterDeliveries.id,
            rows.map((r) => r.deliveryId),
          ),
        );
      continue;
    }
    const recipients = rows
      .filter((r) => r.token)
      .sort((a, b) => a.subscriberId.localeCompare(b.subscriberId))
      .map((r) => ({ deliveryId: r.deliveryId, subscriberId: r.subscriberId, email: r.email, token: r.token! }));
    const outcome = await deliverBatch(db, issue, recipients, key, env, fetchImpl);
    if (outcome.kind === "unknown") {
      interrupted = outcome.error;
      break;
    }
    await pause();
  }

  // 2. New batches: claim recipients, then send.
  while (!interrupted) {
    const candidates = await db
      .select({ id: newsletterSubscribers.id, email: newsletterSubscribers.email, token: newsletterSubscribers.token })
      .from(newsletterSubscribers)
      .where(
        and(
          eligibleSubscribers(issue.locale),
          sql`not exists (select 1 from ${newsletterDeliveries} where ${newsletterDeliveries.issueId} = ${issueId} and ${newsletterDeliveries.subscriberId} = ${newsletterSubscribers.id})`,
        ),
      )
      .orderBy(asc(newsletterSubscribers.id))
      .limit(batchSize);
    if (candidates.length === 0) break;
    let key = batchKey(
      issueId,
      candidates.map((c) => c.id),
    );
    const inserted = await db
      .insert(newsletterDeliveries)
      .values(candidates.map((c) => ({ issueId, subscriberId: c.id, status: "pending", providerId: `batch:${key}` })))
      .onConflictDoNothing({ target: [newsletterDeliveries.issueId, newsletterDeliveries.subscriberId] })
      .returning({ id: newsletterDeliveries.id, subscriberId: newsletterDeliveries.subscriberId });
    if (inserted.length === 0) continue;
    if (inserted.length !== candidates.length) {
      // Another sender claimed some of them; re-key the batch to exactly what we own.
      key = batchKey(
        issueId,
        inserted.map((r) => r.subscriberId),
      );
      await db
        .update(newsletterDeliveries)
        .set({ providerId: `batch:${key}` })
        .where(
          inArray(
            newsletterDeliveries.id,
            inserted.map((r) => r.id),
          ),
        );
    }
    const bySub = new Map(candidates.map((c) => [c.id, c]));
    const recipients = inserted
      .map((r) => ({
        deliveryId: r.id,
        subscriberId: r.subscriberId,
        email: bySub.get(r.subscriberId)!.email,
        token: bySub.get(r.subscriberId)!.token!,
      }))
      .sort((a, b) => a.subscriberId.localeCompare(b.subscriberId));
    const outcome = await deliverBatch(db, issue, recipients, key, env, fetchImpl);
    if (outcome.kind === "unknown") interrupted = outcome.error;
    else await pause();
  }

  const counts = await digestDeliveryCounts(db, issueId);
  const done = !interrupted && counts.pending === 0;
  const status: DigestIssue["status"] = done ? (counts.sent > 0 || counts.failed === 0 ? "sent" : "failed") : "failed";
  const error = interrupted
    ? `Interrupted (${interrupted}); send again to resume`
    : counts.failed > 0
      ? `${counts.failed} deliveries failed`
      : null;
  await db
    .update(newsletterIssues)
    .set({
      status,
      delivered: counts.sent,
      failed: counts.failed,
      error,
      sentAt: status === "sent" ? now : null,
      scheduledFor: null,
    })
    .where(eq(newsletterIssues.id, issueId));
  return {
    status,
    delivered: counts.sent,
    failed: counts.failed,
    pending: counts.pending,
    message: interrupted
      ? `Sent ${counts.sent}; interrupted, send again to resume`
      : `Sent ${counts.sent}${counts.failed ? `, ${counts.failed} failed` : ""}`,
  };
}

/**
 * Deletes failed delivery rows of an issue so the next send retries those subscribers. Only for
 * definite failures: pending rows (outcome unknown) are left alone.
 */
export async function retryFailedDigestDeliveries(db: DbOrTx, issueId: string): Promise<number> {
  const rows = await db
    .delete(newsletterDeliveries)
    .where(and(eq(newsletterDeliveries.issueId, issueId), eq(newsletterDeliveries.status, "failed")))
    .returning({ id: newsletterDeliveries.id });
  if (rows.length) {
    await db
      .update(newsletterIssues)
      .set({ status: "failed", error: `${rows.length} deliveries queued for retry` })
      .where(and(eq(newsletterIssues.id, issueId), eq(newsletterIssues.status, "sent")));
  }
  return rows.length;
}

/** Sends one preview copy (not recorded as a delivery; the unsubscribe link is inert). */
export async function sendDigestTest(
  db: DbOrTx,
  issueId: string,
  to: string,
  opts: { env?: NewsletterEnv; fetch?: typeof fetch } = {},
): Promise<string> {
  const env = opts.env ?? newsletterEnvFromProcess();
  assertCanSend(env);
  const issue = await getDigestIssue(db, issueId);
  if (!issue) throw new DomainError("not_found", "Issue not found");
  const message = renderDigestEmail(issue, {
    siteUrl: env.siteUrl,
    siteName: env.siteName,
    unsubscribeUrl: newsletterPageUrl(env, issue.locale, "unsubscribe", "preview"),
  });
  const outcome = await postBatch(
    env,
    `digest-test/${issue.id}/${Date.now()}`,
    [{ from: env.emailFrom, to: [to], subject: `[Test] ${message.subject}`, html: message.html, text: message.text }],
    opts.fetch ?? fetch,
  );
  if (outcome.kind !== "sent") throw new DomainError("invalid", `Test email failed: ${outcome.error}`);
  return `Test sent to ${to}`;
}

/** Subscribers by locale and state, for the CMS. */
export async function newsletterSubscriberStats(db: DbOrTx) {
  const rows = await db
    .select({
      locale: newsletterSubscribers.locale,
      confirmed: sql<number>`count(*) filter (where ${newsletterSubscribers.confirmedAt} is not null and ${newsletterSubscribers.unsubscribedAt} is null)::int`,
      pending: sql<number>`count(*) filter (where ${newsletterSubscribers.confirmedAt} is null and ${newsletterSubscribers.unsubscribedAt} is null)::int`,
      unsubscribed: sql<number>`count(*) filter (where ${newsletterSubscribers.unsubscribedAt} is not null)::int`,
    })
    .from(newsletterSubscribers)
    .groupBy(newsletterSubscribers.locale)
    .orderBy(asc(newsletterSubscribers.locale));
  return rows;
}

/** Recent failed deliveries of an issue, for the CMS. */
export async function listDigestFailures(db: DbOrTx, issueId: string, limit = 50) {
  return db
    .select({
      email: newsletterSubscribers.email,
      error: newsletterDeliveries.error,
      at: newsletterDeliveries.createdAt,
    })
    .from(newsletterDeliveries)
    .innerJoin(newsletterSubscribers, eq(newsletterSubscribers.id, newsletterDeliveries.subscriberId))
    .where(and(eq(newsletterDeliveries.issueId, issueId), eq(newsletterDeliveries.status, "failed")))
    .orderBy(desc(newsletterDeliveries.createdAt))
    .limit(limit);
}

/**
 * Hourly worker entry (FR-WEB-9): at the configured weekday/hour, builds last week's issue for every
 * public locale and sends it (autoSend) or leaves a draft and notifies the editors. Every run also
 * sends due scheduled issues and resumes interrupted sends.
 */
export async function runDigestSchedule(
  db: DbOrTx,
  opts: { now?: Date; env?: NewsletterEnv; fetch?: typeof fetch; pauseMs?: number } = {},
) {
  const now = opts.now ?? new Date();
  const env = opts.env ?? newsletterEnvFromProcess();
  const policy = await getSetting(db, "newsletter.digest");
  const canSend = !!env.resendApiKey && !!env.emailFrom;
  const built: Array<{ locale: string; issueId: string | null; created: boolean }> = [];
  const sent: Array<{ issueId: string; result: DigestSendResult | string }> = [];

  if (policy?.enabled && now.getUTCDay() === policy.weekday && now.getUTCHours() === policy.hourUtc) {
    const locales = (await getSetting(db, "i18n.policy"))?.enabledLocales ?? ["en"];
    for (const locale of locales) {
      const result = await buildDigestIssue(db, { locale, now, maxItems: policy.maxItems, env });
      built.push({ locale, issueId: result?.issue.id ?? null, created: !!result?.created });
      if (!result?.created) continue;
      if (policy.autoSend && canSend) {
        await db
          .update(newsletterIssues)
          .set({ status: "scheduled", scheduledFor: now })
          .where(eq(newsletterIssues.id, result.issue.id));
      } else {
        await notify(db, {
          event: "newsletter.ready",
          title: `Newsletter draft ready (${locale}): ${result.issue.subject}`,
          body:
            policy.autoSend && !canSend ? "Auto-send is on but RESEND_API_KEY/NOTIFY_EMAIL_FROM are missing." : null,
          href: `/newsletter/${result.issue.id}`,
          entityType: "newsletter_issue",
          entityId: result.issue.id,
          dedupeKey: `newsletter.ready:${result.issue.id}`,
        });
      }
    }
  }

  const due = await db
    .select({ id: newsletterIssues.id })
    .from(newsletterIssues)
    .where(
      sql`(${newsletterIssues.status} = 'scheduled' and ${newsletterIssues.scheduledFor} <= ${now.toISOString()}::timestamptz) or ${newsletterIssues.status} = 'sending'`,
    )
    .orderBy(asc(newsletterIssues.scheduledFor));
  for (const { id } of due) {
    if (!canSend) {
      sent.push({ issueId: id, result: "skipped: RESEND_API_KEY or NOTIFY_EMAIL_FROM not set" });
      continue;
    }
    try {
      sent.push({
        issueId: id,
        result: await sendDigestIssue(db, id, { env, fetch: opts.fetch, now, pauseMs: opts.pauseMs }),
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      sent.push({ issueId: id, result: `error: ${error.message}` });
    }
  }
  return { built, sent };
}
