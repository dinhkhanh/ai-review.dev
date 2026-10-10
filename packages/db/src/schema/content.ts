import type { ArticleBody, QaScorecard, Seo } from "@repo/content";
import { index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { DEFAULT_LOCALE, id, timestamps } from "./_shared";
import { products } from "./catalog";

export const articleType = pgEnum("article_type", ["review", "comparison", "alternatives", "best_of"]);
/** Review state machine (FR-QA-2). */
export const articleStatus = pgEnum("article_status", [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "published",
  "archived",
]);
export const mediaKind = pgEnum("media_kind", ["image", "screenshot", "graphic", "video", "audio", "logo"]);
export const mediaOrigin = pgEnum("media_origin", ["generated", "templated", "captured", "vendor", "uploaded"]);
export const videoKind = pgEnum("video_kind", ["short", "long"]);
export const videoStatus = pgEnum("video_status", ["draft", "rendering", "ready", "published", "failed"]);

export const authors = pgTable("authors", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  bio: text("bio"),
  avatarAssetId: uuid("avatar_asset_id"),
  userId: text("user_id"),
  links: jsonb("links").$type<Record<string, string>>().notNull().default({}),
  ...timestamps(),
});

export const articles = pgTable(
  "articles",
  {
    id: id(),
    type: articleType("type").notNull(),
    slug: text("slug").notNull(),
    locale: text("locale").notNull().default(DEFAULT_LOCALE),
    title: text("title").notNull(),
    status: articleStatus("status").notNull().default("draft"),
    /** Primary product for reviews; comparisons/lists use `productIds`. */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productIds: uuid("product_ids").array().notNull().default([]),
    currentVersionId: uuid("current_version_id"),
    authorId: uuid("author_id").references(() => authors.id, { onDelete: "set null" }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("articles_type_slug_locale_uq").on(t.type, t.slug, t.locale),
    index("articles_status_idx").on(t.status),
    index("articles_product_idx").on(t.productId),
  ],
);

/** Immutable article versions (FR-CON-11). */
export const articleVersions = pgTable(
  "article_versions",
  {
    id: id(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    blocks: jsonb("blocks").$type<ArticleBody>().notNull(),
    seo: jsonb("seo").$type<Seo>(),
    overallScore: real("overall_score"),
    qaScorecard: jsonb("qa_scorecard").$type<QaScorecard>(),
    promptVersions: jsonb("prompt_versions").$type<Record<string, string>>(),
    createdByJobId: uuid("created_by_job_id"),
    createdByUserId: text("created_by_user_id"),
    changeNote: text("change_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("article_versions_article_version_uq").on(t.articleId, t.version)],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: id(),
    kind: mediaKind("kind").notNull(),
    origin: mediaOrigin("origin").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes"),
    /** Resized/format variants: { card: { key, width, height, mime }, ... } (FR-MED-4). */
    variants: jsonb("variants")
      .$type<Record<string, { key: string; width: number; height: number; mime: string }>>()
      .notNull()
      .default({}),
    alt: text("alt"),
    licenseNote: text("license_note"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("media_assets_product_idx").on(t.productId)],
);

export const videos = pgTable("videos", {
  id: id(),
  articleId: uuid("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  kind: videoKind("kind").notNull(),
  status: videoStatus("status").notNull().default("draft"),
  script: jsonb("script").$type<Record<string, unknown>>(),
  audioAssetId: uuid("audio_asset_id"),
  videoAssetId: uuid("video_asset_id"),
  thumbnailAssetId: uuid("thumbnail_asset_id"),
  youtubeId: text("youtube_id"),
  durationSeconds: integer("duration_seconds"),
  ...timestamps(),
});
