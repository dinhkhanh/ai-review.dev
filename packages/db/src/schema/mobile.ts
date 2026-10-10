import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { DEFAULT_LOCALE, id, timestamps } from "./_shared";
import { products } from "./catalog";
import { articles } from "./content";

/**
 * Anonymous mobile devices (FR-API-4). The app registers once and receives a random device secret;
 * only its SHA-256 is stored. No visitor accounts: everything below hangs off the device.
 */
export const devices = pgTable(
  "devices",
  {
    id: id(),
    secretHash: text("secret_hash").notNull(),
    /** "ios" | "android" | "web". */
    platform: text("platform").notNull(),
    /** Expo push token, when the user granted notification permission. */
    pushToken: text("push_token"),
    locale: text("locale").notNull().default(DEFAULT_LOCALE),
    appVersion: text("app_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when Expo reports DeviceNotRegistered or the user deletes their data. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("devices_secret_hash_uq").on(t.secretHash), uniqueIndex("devices_push_token_uq").on(t.pushToken)],
);

/** Articles a device saved for later (FR-API-4). */
export const savedItems = pgTable(
  "saved_items",
  {
    id: id(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saved_items_device_article_uq").on(t.deviceId, t.articleId)],
);

/** Price-change alert subscriptions: a device follows a product (FR-API-4). */
export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: id(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_alerts_device_product_uq").on(t.deviceId, t.productId),
    index("price_alerts_product_idx").on(t.productId),
  ],
);

/**
 * Pricing changes detected by the refresh pipeline (FR-MNT-2), the source of price-change pushes.
 * `changes` is a list of { plan, field, before, after } lines from the fact-sheet diff.
 */
export const priceChanges = pgTable(
  "price_changes",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    summary: text("summary").notNull(),
    changes: jsonb("changes").$type<Array<Record<string, unknown>>>().notNull().default([]),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set once pushes went out; null means pending (the push task picks these up). */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    pushSent: integer("push_sent").notNull().default(0),
    pushFailed: integer("push_failed").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("price_changes_product_idx").on(t.productId, t.detectedAt),
    index("price_changes_pending_idx").on(t.notifiedAt),
  ],
);
