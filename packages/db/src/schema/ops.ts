import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";

/** Admin action audit trail (FR-CMS-1). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt), index("audit_log_entity_idx").on(t.entityType, t.entityId)],
);

/** Key/value settings edited in the CMS (FR-CMS-7). Values validated in @repo/core. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedByUserId: text("updated_by_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reportStatus = pgEnum("report_status", ["open", "resolved", "dismissed"]);

/** Visitor "report an error / pricing changed" submissions (FR-WEB-6, FR-WEB-10). */
export const errorReports = pgTable("error_reports", {
  id: id(),
  articleId: uuid("article_id"),
  productId: uuid("product_id"),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  email: text("email"),
  status: reportStatus("status").notNull().default("open"),
  ...timestamps(),
});

export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: id(),
  email: text("email").notNull().unique(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  source: text("source"),
  /** Random token for the double opt-in confirmation and unsubscribe links (FR-WEB-9, FR-API-3). */
  token: text("token").unique(),
  tokenSentAt: timestamp("token_sent_at", { withTimezone: true }),
  /** Locale of the digest the subscriber receives (phase 3). */
  locale: text("locale").notNull().default("en"),
  /** Last digest issue delivered, for "what's new since" and skip-if-already-sent. */
  lastIssueId: uuid("last_issue_id"),
  ...timestamps(),
});

export const newsletterIssueStatus = pgEnum("newsletter_issue_status", [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
]);

/** Weekly digest issue (FR-WEB-9), one per locale per period; built from new/updated reviews. */
export const newsletterIssues = pgTable(
  "newsletter_issues",
  {
    id: id(),
    locale: text("locale").notNull().default("en"),
    /** Inclusive period start (Monday) the digest covers. */
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    subject: text("subject").notNull(),
    /** Optional editor intro, plain text / inline markdown. */
    intro: text("intro"),
    /** Snapshot of digest entries: [{ articleId, kind: "new"|"updated", title, summary, url, ... }]. */
    items: jsonb("items").$type<Array<Record<string, unknown>>>().notNull().default([]),
    status: newsletterIssueStatus("status").notNull().default("draft"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    recipients: integer("recipients").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    error: text("error"),
    createdByUserId: text("created_by_user_id"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("newsletter_issues_locale_period_uq").on(t.locale, t.periodStart)],
);

/** One digest email per subscriber per issue; the unique key makes resends idempotent. */
export const newsletterDeliveries = pgTable(
  "newsletter_deliveries",
  {
    id: id(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => newsletterIssues.id, { onDelete: "cascade" }),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => newsletterSubscribers.id, { onDelete: "cascade" }),
    /** "sent" | "failed" | "skipped". */
    status: text("status").notNull(),
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("newsletter_deliveries_issue_sub_uq").on(t.issueId, t.subscriberId)],
);

export const notificationSeverity = pgEnum("notification_severity", ["info", "success", "warning", "error"]);

/**
 * Admin notifications (FR-CMS-8): shown in the CMS inbox and delivered by email/webhook.
 * `dedupeKey` suppresses repeats of the same event (e.g. one "link broken" per link per day).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    event: text("event").notNull(),
    severity: notificationSeverity("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body"),
    /** CMS path to open, e.g. /jobs/<id>. */
    href: text("href"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    dedupeKey: text("dedupe_key"),
    /** Delivery outcome per channel: { email: "sent" | "skipped" | "error: ..." }. */
    delivery: jsonb("delivery").$type<Record<string, string>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_created_idx").on(t.createdAt), uniqueIndex("notifications_dedupe_uq").on(t.dedupeKey)],
);

/** "Was this helpful?" votes (FR-WEB-10), one per visitor (hashed IP, daily salt) per article per day. */
export const helpfulVotes = pgTable(
  "helpful_votes",
  {
    id: id(),
    articleId: uuid("article_id").notNull(),
    helpful: boolean("helpful").notNull(),
    ipHash: text("ip_hash").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("helpful_votes_article_ip_day_uq").on(t.articleId, t.ipHash, t.day),
    index("helpful_votes_article_idx").on(t.articleId),
  ],
);

/** Daily page views imported from Plausible (FR-ANL-2 funnel, FR-MNT-1 top-traffic cadence). */
export const pageViewsDaily = pgTable(
  "page_views_daily",
  {
    day: date("day", { mode: "string" }).notNull(),
    path: text("path").notNull(),
    articleId: uuid("article_id"),
    pageviews: integer("pageviews").notNull().default(0),
    visitors: integer("visitors").notNull().default(0),
  },
  (t) => [
    uniqueIndex("page_views_daily_day_path_uq").on(t.day, t.path),
    index("page_views_daily_article_idx").on(t.articleId),
  ],
);

/** Search Console performance per page per day (FR-MNT-3). `page` is the site path. */
export const searchConsoleDaily = pgTable(
  "search_console_daily",
  {
    day: date("day", { mode: "string" }).notNull(),
    page: text("page").notNull(),
    articleId: uuid("article_id"),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    /** Impression-weighted average position. */
    position: real("position"),
  },
  (t) => [
    uniqueIndex("search_console_daily_day_page_uq").on(t.day, t.page),
    index("search_console_daily_article_idx").on(t.articleId, t.day),
  ],
);

/** Top queries per page over a rolling window, refreshed by each import (feeds refresh briefs). */
export const searchConsoleQueries = pgTable(
  "search_console_queries",
  {
    page: text("page").notNull(),
    query: text("query").notNull(),
    articleId: uuid("article_id"),
    /** Window the figures cover, e.g. the last 28 days ending `windowEnd`. */
    windowEnd: date("window_end", { mode: "string" }).notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    position: real("position"),
  },
  (t) => [
    uniqueIndex("search_console_queries_page_query_uq").on(t.page, t.query),
    index("search_console_queries_article_idx").on(t.articleId),
  ],
);
