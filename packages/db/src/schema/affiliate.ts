import type { LinkFormat } from "@repo/affiliate";
import { KNOWN_NETWORKS } from "@repo/affiliate";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { products } from "./catalog";
import { articles } from "./content";

export const programStatus = pgEnum("program_status", [
  "not_found",
  "found",
  "applied",
  "approved",
  "active",
  "paused",
  "rejected",
  "terminated",
]);
export const redirectPolicy = pgEnum("redirect_policy", ["allowed", "forbidden", "unknown"]);
export const commissionModel = pgEnum("commission_model", [
  "recurring_percent",
  "one_time_percent",
  "flat_per_sale",
  "flat_per_lead",
  "hybrid",
  "unknown",
]);
export const linkStatus = pgEnum("link_status", ["pending", "active", "paused", "broken"]);
export const affiliateNetwork = pgEnum("affiliate_network", KNOWN_NETWORKS);
export const conversionStatus = pgEnum("conversion_status", ["pending", "approved", "reversed", "paid"]);

export const affiliatePrograms = pgTable(
  "affiliate_programs",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    network: affiliateNetwork("network").notNull(),
    name: text("name").notNull(),
    status: programStatus("status").notNull().default("found"),
    commissionModel: commissionModel("commission_model").notNull().default("unknown"),
    /** Percent (e.g. 30 = 30%) or flat amount in `commissionCurrency`, depending on the model. */
    commissionValue: numeric("commission_value", { precision: 10, scale: 2 }),
    commissionCurrency: text("commission_currency").default("USD"),
    recurringMonths: smallint("recurring_months"),
    cookieDays: smallint("cookie_days"),
    signupUrl: text("signup_url"),
    dashboardUrl: text("dashboard_url"),
    termsUrl: text("terms_url"),
    linkFormat: jsonb("link_format").$type<LinkFormat>(),
    redirectPolicy: redirectPolicy("redirect_policy").notNull().default("unknown"),
    evidence: jsonb("evidence").$type<Array<{ url: string; note?: string }>>().notNull().default([]),
    draftApplication: text("draft_application"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [index("affiliate_programs_product_idx").on(t.productId), index("affiliate_programs_status_idx").on(t.status)],
);

export const affiliateLinks = pgTable(
  "affiliate_links",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    programId: uuid("program_id").references(() => affiliatePrograms.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    destinationUrl: text("destination_url").notNull(),
    /** ISO country code or "global". */
    region: text("region").notNull().default("global"),
    status: linkStatus("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(100),
    weight: integer("weight").notNull().default(100),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
    healthDetail: text("health_detail"),
    /** Consecutive failed health checks (FR-AFF-10); the link is paused after the configured limit. */
    healthFailures: smallint("health_failures").notNull().default(0),
    /** Landing URL after following redirects at the last health check. */
    finalUrl: text("final_url"),
    notes: text("notes"),
    /** A/B offer test this link is a variant of (FR-AFF-13). */
    experimentId: uuid("experiment_id"),
    ...timestamps(),
  },
  (t) => [
    index("affiliate_links_product_status_idx").on(t.productId, t.status),
    index("affiliate_links_experiment_idx").on(t.experimentId),
  ],
);

export const experimentStatus = pgEnum("experiment_status", ["running", "stopped", "completed"]);

/**
 * A/B offer test (FR-AFF-13): two or more links for one product share a priority and split traffic
 * by weight; clicks and conversions are reported per variant (link) and a winner can be promoted.
 */
export const affiliateExperiments = pgTable(
  "affiliate_experiments",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: experimentStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    winnerLinkId: uuid("winner_link_id"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id"),
    ...timestamps(),
  },
  (t) => [index("affiliate_experiments_product_idx").on(t.productId, t.status)],
);

/** Public go-link slug -> product (FR-AFF-6). CTAs reference slugs, never raw URLs. */
export const goSlugs = pgTable("go_slugs", {
  slug: text("slug").primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  /** Used when no active affiliate link exists (FR-AFF-5 fallback). */
  fallbackUrl: text("fallback_url").notNull(),
  ...timestamps(),
});

/**
 * Click log (FR-AFF-7). Cookieless; IPs are hashed with a rotating salt (NFR-8).
 * Monthly partitioning is planned once volume warrants it (docs/plan.md §3).
 */
export const clicks = pgTable(
  "clicks",
  {
    id: id(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    goSlug: text("go_slug").notNull(),
    linkId: uuid("link_id"),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    placement: text("placement"),
    path: text("path"),
    country: text("country"),
    device: text("device"),
    ipHash: text("ip_hash"),
    uaHash: text("ua_hash"),
    isBot: boolean("is_bot").notNull().default(false),
    fallback: boolean("fallback").notNull().default(false),
    /** A/B test the chosen link belonged to at click time (FR-AFF-13). */
    experimentId: uuid("experiment_id"),
    /** Page locale the click came from (phase 3 second locale). */
    locale: text("locale"),
  },
  (t) => [index("clicks_ts_idx").on(t.ts), index("clicks_slug_ts_idx").on(t.goSlug, t.ts)],
);

/** One conversion import run (CSV upload or network API sync, FR-AFF-11). */
export const conversionImports = pgTable("conversion_imports", {
  id: id(),
  network: affiliateNetwork("network"),
  source: text("source").notNull(),
  filename: text("filename"),
  rows: integer("rows").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  unmatched: integer("unmatched").notNull().default(0),
  errors: jsonb("errors").$type<Array<{ row: number; message: string }>>().notNull().default([]),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversions = pgTable(
  "conversions",
  {
    id: id(),
    network: affiliateNetwork("network").notNull(),
    programId: uuid("program_id").references(() => affiliatePrograms.id, { onDelete: "set null" }),
    subId: text("sub_id"),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    /** Attribution parsed from the SubID / program (FR-AFF-12). */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    placement: text("placement"),
    /** Variant link, when the SubID carried a variant token (FR-AFF-13). */
    linkId: uuid("link_id"),
    importId: uuid("import_id").references(() => conversionImports.id, { onDelete: "set null" }),
    externalOrderId: text("external_order_id"),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    commission: numeric("commission", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    status: conversionStatus("status").notNull().default("pending"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("conversions_network_order_uq").on(t.network, t.externalOrderId),
    index("conversions_subid_idx").on(t.subId),
    index("conversions_occurred_idx").on(t.occurredAt),
    index("conversions_article_idx").on(t.articleId),
    index("conversions_link_idx").on(t.linkId),
  ],
);

/** Deals and coupons shown on /deals and review pages (FR-WEB-8). Links go through the go-slug. */
export const deals = pgTable(
  "deals",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    programId: uuid("program_id").references(() => affiliatePrograms.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    /** Promo code, if the deal needs one. */
    code: text("code"),
    /** Short badge text, e.g. "30% off first year" or "14-day free trial". */
    discountText: text("discount_text"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    /** "manual", "program" (from affiliate terms) or "fact_sheet" (free trial/plan). */
    source: text("source").notNull().default("manual"),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("deals_product_idx").on(t.productId), index("deals_active_idx").on(t.active, t.endsAt)],
);
