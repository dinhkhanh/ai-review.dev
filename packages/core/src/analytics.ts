import { sql, type DbOrTx } from "@repo/db";

/**
 * Revenue, funnel and cost analytics for the CMS (FR-AFF-12, FR-ANL-2, FR-ANL-3, FR-ANL-4).
 * Revenue means commission on approved or paid conversions; pending commission is reported
 * separately and reversed conversions are ignored. Clicks are human clicks only.
 * Ranges are [from, to).
 */
export interface DateRange {
  from: Date;
  to: Date;
}

const iso = (d: Date) => d.toISOString();
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export interface RevenueRow {
  key: string | null;
  label: string | null;
  clicks: number;
  conversions: number;
  revenueUsd: number;
  pendingUsd: number;
  /** Earnings per click (revenue / clicks). */
  epc: number | null;
  /** Conversions per click. */
  conversionRate: number | null;
}

type RevenueDimension = "article" | "product" | "placement" | "month";

/** Revenue with clicks, EPC and conversion rate grouped by article, product, placement or month (FR-AFF-12). */
export async function revenueBy(db: DbOrTx, dimension: RevenueDimension, range: DateRange): Promise<RevenueRow[]> {
  const conv = {
    article: sql`c.article_id::text`,
    product: sql`c.product_id::text`,
    placement: sql`c.placement`,
    month: sql`to_char(date_trunc('month', c.occurred_at at time zone 'UTC'), 'YYYY-MM')`,
  }[dimension];
  const click = {
    article: sql`k.article_id::text`,
    product: sql`g.product_id::text`,
    placement: sql`k.placement`,
    month: sql`to_char(date_trunc('month', k.ts at time zone 'UTC'), 'YYYY-MM')`,
  }[dimension];
  const label = {
    article: sql`(select title from articles a where a.id::text = t.key)`,
    product: sql`(select name from products p where p.id::text = t.key)`,
    placement: sql`t.key`,
    month: sql`t.key`,
  }[dimension];
  const rows = await db.execute<Record<string, unknown>>(sql`
    with cv as (
      select coalesce(${conv}, '') as key,
        count(*) filter (where c.status <> 'reversed') as conversions,
        coalesce(sum(c.commission) filter (where c.status in ('approved', 'paid')), 0) as revenue,
        coalesce(sum(c.commission) filter (where c.status = 'pending'), 0) as pending
      from conversions c
      where c.occurred_at >= ${iso(range.from)}::timestamptz and c.occurred_at < ${iso(range.to)}::timestamptz
      group by 1
    ), ck as (
      select coalesce(${click}, '') as key, count(*) as clicks
      from clicks k left join go_slugs g on g.slug = k.go_slug
      where not k.is_bot and k.ts >= ${iso(range.from)}::timestamptz and k.ts < ${iso(range.to)}::timestamptz
      group by 1
    ), t as (
      select coalesce(cv.key, ck.key) as key, coalesce(ck.clicks, 0) as clicks, coalesce(cv.conversions, 0) as conversions,
        coalesce(cv.revenue, 0) as revenue, coalesce(cv.pending, 0) as pending
      from cv full outer join ck on cv.key = ck.key
    )
    select nullif(t.key, '') as key, ${label} as label, t.clicks::int, t.conversions::int, t.revenue::float8 as revenue, t.pending::float8 as pending
    from t order by ${dimension === "month" ? sql`t.key desc` : sql`t.revenue desc, t.clicks desc`}
    limit 500`);
  return rows.map((r) => {
    const clicks = n(r.clicks);
    const conversions = n(r.conversions);
    const revenueUsd = n(r.revenue);
    return {
      key: (r.key as string | null) ?? null,
      label: (r.label as string | null) ?? null,
      clicks,
      conversions,
      revenueUsd,
      pendingUsd: n(r.pending),
      epc: ratio(revenueUsd, clicks),
      conversionRate: ratio(conversions, clicks),
    };
  });
}

export interface FunnelRow {
  articleId: string;
  title: string;
  type: string;
  slug: string;
  pageviews: number;
  clicks: number;
  conversions: number;
  revenueUsd: number;
  /** CTA clicks per pageview. */
  ctr: number | null;
  conversionRate: number | null;
}

/** Per-article funnel: views → CTA clicks → conversions → commission (FR-ANL-2). */
export async function articleFunnel(db: DbOrTx, range: DateRange, limit = 200): Promise<FunnelRow[]> {
  const from = iso(range.from);
  const to = iso(range.to);
  const rows = await db.execute<Record<string, unknown>>(sql`
    with pv as (
      select article_id, sum(pageviews) as pageviews from page_views_daily
      where article_id is not null and day >= ${from.slice(0, 10)}::date and day < ${to.slice(0, 10)}::date
      group by 1
    ), ck as (
      select article_id, count(*) as clicks from clicks
      where article_id is not null and not is_bot and ts >= ${from}::timestamptz and ts < ${to}::timestamptz
      group by 1
    ), cv as (
      select article_id, count(*) filter (where status <> 'reversed') as conversions,
        coalesce(sum(commission) filter (where status in ('approved', 'paid')), 0) as revenue
      from conversions
      where article_id is not null and occurred_at >= ${from}::timestamptz and occurred_at < ${to}::timestamptz
      group by 1
    )
    select a.id, a.title, a.type, a.slug, coalesce(pv.pageviews, 0)::int as pageviews, coalesce(ck.clicks, 0)::int as clicks,
      coalesce(cv.conversions, 0)::int as conversions, coalesce(cv.revenue, 0)::float8 as revenue
    from articles a
    left join pv on pv.article_id = a.id left join ck on ck.article_id = a.id left join cv on cv.article_id = a.id
    where pv.article_id is not null or ck.article_id is not null or cv.article_id is not null
    order by revenue desc, clicks desc, pageviews desc
    limit ${limit}`);
  return rows.map((r) => {
    const pageviews = n(r.pageviews);
    const clicks = n(r.clicks);
    const conversions = n(r.conversions);
    return {
      articleId: String(r.id),
      title: String(r.title),
      type: String(r.type),
      slug: String(r.slug),
      pageviews,
      clicks,
      conversions,
      revenueUsd: n(r.revenue),
      ctr: ratio(clicks, pageviews),
      conversionRate: ratio(conversions, clicks),
    };
  });
}

/** CTR per placement across all articles (clicks per article pageview) (FR-ANL-2). */
export async function placementCtr(db: DbOrTx, range: DateRange, articleId?: string | null) {
  const from = iso(range.from);
  const to = iso(range.to);
  const articleFilter = articleId ? sql`and article_id = ${articleId}::uuid` : sql``;
  const [pv] = await db.execute<{ pageviews: number }>(sql`
    select coalesce(sum(pageviews), 0)::int as pageviews from page_views_daily
    where article_id is not null ${articleFilter} and day >= ${from.slice(0, 10)}::date and day < ${to.slice(0, 10)}::date`);
  const rows = await db.execute<Record<string, unknown>>(sql`
    with ck as (
      select coalesce(placement, 'direct') as placement, count(*) as clicks from clicks
      where not is_bot ${articleFilter} and ts >= ${from}::timestamptz and ts < ${to}::timestamptz group by 1
    ), cv as (
      select coalesce(placement, 'direct') as placement, count(*) filter (where status <> 'reversed') as conversions,
        coalesce(sum(commission) filter (where status in ('approved', 'paid')), 0) as revenue
      from conversions where occurred_at >= ${from}::timestamptz and occurred_at < ${to}::timestamptz ${articleFilter}
      group by 1
    )
    select coalesce(ck.placement, cv.placement) as placement, coalesce(ck.clicks, 0)::int as clicks,
      coalesce(cv.conversions, 0)::int as conversions, coalesce(cv.revenue, 0)::float8 as revenue
    from ck full outer join cv on ck.placement = cv.placement order by clicks desc`);
  const pageviews = n(pv?.pageviews);
  return {
    pageviews,
    placements: rows.map((r) => ({
      placement: String(r.placement),
      clicks: n(r.clicks),
      conversions: n(r.conversions),
      revenueUsd: n(r.revenue),
      ctr: ratio(n(r.clicks), pageviews),
      epc: ratio(n(r.revenue), n(r.clicks)),
    })),
  };
}

export interface CostRow {
  key: string;
  costUsd: number;
  calls: number;
}

/** AI/API spend grouped by pipeline step, model, provider or month (FR-ANL-3). */
export async function costsBy(
  db: DbOrTx,
  dimension: "step" | "model" | "provider" | "month",
  range: DateRange,
): Promise<CostRow[]> {
  const key = {
    step: sql`coalesce(s.name, l.operation)`,
    model: sql`coalesce(l.model, l.provider)`,
    provider: sql`l.provider`,
    month: sql`to_char(date_trunc('month', l.created_at at time zone 'UTC'), 'YYYY-MM')`,
  }[dimension];
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${key} as key, sum(l.cost_usd)::float8 as cost, count(*)::int as calls
    from cost_ledger l left join job_steps s on s.id = l.step_id
    where l.created_at >= ${iso(range.from)}::timestamptz and l.created_at < ${iso(range.to)}::timestamptz
    group by 1 order by ${dimension === "month" ? sql`1 desc` : sql`2 desc`}`);
  return rows.map((r) => ({ key: String(r.key ?? "—"), costUsd: n(r.cost), calls: n(r.calls) }));
}

export interface ArticleMarginRow {
  articleId: string;
  title: string;
  status: string;
  costUsd: number;
  revenueUsd: number;
  pendingUsd: number;
  marginUsd: number;
}

/**
 * Lifetime cost (all jobs that produced or refreshed the article) against lifetime commission,
 * per article (FR-ANL-3 margin per article), plus the average cost per published article.
 */
export async function articleMargins(db: DbOrTx, limit = 200) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    with cost as (select article_id, sum(total_cost_usd) as cost from review_jobs where article_id is not null group by 1),
    rev as (
      select article_id, coalesce(sum(commission) filter (where status in ('approved', 'paid')), 0) as revenue,
        coalesce(sum(commission) filter (where status = 'pending'), 0) as pending
      from conversions where article_id is not null group by 1
    )
    select a.id, a.title, a.status, coalesce(cost.cost, 0)::float8 as cost, coalesce(rev.revenue, 0)::float8 as revenue,
      coalesce(rev.pending, 0)::float8 as pending
    from articles a left join cost on cost.article_id = a.id left join rev on rev.article_id = a.id
    where cost.article_id is not null or rev.article_id is not null
    order by (coalesce(rev.revenue, 0) - coalesce(cost.cost, 0)) desc
    limit ${limit}`);
  const margins: ArticleMarginRow[] = rows.map((r) => ({
    articleId: String(r.id),
    title: String(r.title),
    status: String(r.status),
    costUsd: n(r.cost),
    revenueUsd: n(r.revenue),
    pendingUsd: n(r.pending),
    marginUsd: n(r.revenue) - n(r.cost),
  }));
  const [avg] = await db.execute<{ articles: number; cost: number }>(sql`
    select count(*)::int as articles, coalesce(avg(c.cost), 0)::float8 as cost from (
      select a.id, coalesce(sum(j.total_cost_usd), 0) as cost
      from articles a left join review_jobs j on j.article_id = a.id
      where a.published_version_id is not null group by a.id
    ) c`);
  return { margins, publishedArticles: n(avg?.articles), costPerPublishedArticleUsd: n(avg?.cost) };
}

/** Headline numbers for the analytics page. */
export async function analyticsTotals(db: DbOrTx, range: DateRange) {
  const from = iso(range.from);
  const to = iso(range.to);
  const [row] = await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*) from clicks where not is_bot and ts >= ${from}::timestamptz and ts < ${to}::timestamptz)::int as clicks,
      (select count(*) from conversions where status <> 'reversed' and occurred_at >= ${from}::timestamptz and occurred_at < ${to}::timestamptz)::int as conversions,
      (select coalesce(sum(commission), 0) from conversions where status in ('approved', 'paid') and occurred_at >= ${from}::timestamptz and occurred_at < ${to}::timestamptz)::float8 as revenue,
      (select coalesce(sum(commission), 0) from conversions where status = 'pending' and occurred_at >= ${from}::timestamptz and occurred_at < ${to}::timestamptz)::float8 as pending,
      (select coalesce(sum(cost_usd), 0) from cost_ledger where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz)::float8 as cost,
      (select coalesce(sum(pageviews), 0) from page_views_daily where day >= ${from.slice(0, 10)}::date and day < ${to.slice(0, 10)}::date)::int as pageviews`);
  const clicks = n(row?.clicks);
  const revenueUsd = n(row?.revenue);
  return {
    pageviews: n(row?.pageviews),
    clicks,
    conversions: n(row?.conversions),
    revenueUsd,
    pendingUsd: n(row?.pending),
    costUsd: n(row?.cost),
    epc: ratio(revenueUsd, clicks),
  };
}

// ---------------------------------------------------------------------------------------------
// CSV export (FR-ANL-4)

/** Serialises rows to CSV (RFC 4180 quoting; formula-leading cells are prefixed against CSV injection). */
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export const EXPORT_KINDS = ["clicks", "conversions", "costs"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const EXPORT_LIMIT = 200_000;

/** Rows and columns for a CSV export of clicks, conversions or costs in a date range. */
export async function exportRows(db: DbOrTx, kind: ExportKind, range: DateRange) {
  const from = iso(range.from);
  const to = iso(range.to);
  if (kind === "clicks") {
    const rows = await db.execute<Record<string, unknown>>(sql`
      select k.ts, k.go_slug, a.slug as article_slug, k.placement, k.path, k.country, k.device, k.link_id,
        k.fallback, k.is_bot
      from clicks k left join articles a on a.id = k.article_id
      where k.ts >= ${from}::timestamptz and k.ts < ${to}::timestamptz order by k.ts limit ${EXPORT_LIMIT}`);
    return {
      columns: [
        "ts",
        "go_slug",
        "article_slug",
        "placement",
        "path",
        "country",
        "device",
        "link_id",
        "fallback",
        "is_bot",
      ],
      rows,
    };
  }
  if (kind === "conversions") {
    const rows = await db.execute<Record<string, unknown>>(sql`
      select c.occurred_at, c.network, p.name as program, c.sub_id, a.slug as article_slug, pr.name as product,
        c.placement, c.external_order_id, c.amount, c.commission, c.currency, c.status, c.imported_at
      from conversions c left join affiliate_programs p on p.id = c.program_id
      left join articles a on a.id = c.article_id left join products pr on pr.id = c.product_id
      where c.occurred_at >= ${from}::timestamptz and c.occurred_at < ${to}::timestamptz
      order by c.occurred_at limit ${EXPORT_LIMIT}`);
    return {
      columns: [
        "occurred_at",
        "network",
        "program",
        "sub_id",
        "article_slug",
        "product",
        "placement",
        "external_order_id",
        "amount",
        "commission",
        "currency",
        "status",
        "imported_at",
      ],
      rows,
    };
  }
  const rows = await db.execute<Record<string, unknown>>(sql`
    select l.created_at, l.job_id, s.name as step, l.provider, l.model, l.operation, l.units, l.unit_type, l.cost_usd
    from cost_ledger l left join job_steps s on s.id = l.step_id
    where l.created_at >= ${from}::timestamptz and l.created_at < ${to}::timestamptz
    order by l.created_at limit ${EXPORT_LIMIT}`);
  return {
    columns: ["created_at", "job_id", "step", "provider", "model", "operation", "units", "unit_type", "cost_usd"],
    rows,
  };
}

/** Parses `from`/`to` query values (YYYY-MM-DD, `to` inclusive) with a default of the last 30 days. */
export function parseDateRange(fromInput?: string | null, toInput?: string | null, now = new Date()): DateRange {
  const valid = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);
  const toDay = valid(toInput) ?? now.toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${toDay}T00:00:00Z`) + 86_400_000);
  const fromDay = valid(fromInput);
  const from = fromDay ? new Date(`${fromDay}T00:00:00Z`) : new Date(to.getTime() - 30 * 86_400_000);
  return from < to ? { from, to } : { from: new Date(to.getTime() - 86_400_000), to };
}
