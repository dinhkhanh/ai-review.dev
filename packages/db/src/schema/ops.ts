import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  ...timestamps(),
});
