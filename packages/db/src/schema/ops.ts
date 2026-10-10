import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
  ...timestamps(),
});

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
