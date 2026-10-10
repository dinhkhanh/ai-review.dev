import type { FactSheet } from "@repo/content";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { DEFAULT_LOCALE, id, timestamps } from "./_shared";

export const productStatus = pgEnum("product_status", ["draft", "active", "discontinued", "archived"]);
export const sourceKind = pgEnum("source_kind", ["official", "aggregator", "community", "video", "news", "other"]);
export const competitorRelation = pgEnum("competitor_relation", ["alternative", "direct"]);

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  parentId: uuid("parent_id"),
  position: smallint("position").notNull().default(0),
  /** Rubric override for this category (FR-CON-3); null means DEFAULT_RUBRIC. */
  rubric: jsonb("rubric").$type<Array<{ key: string; label: string; weight: number }>>(),
  ...timestamps(),
});

export const tags = pgTable("tags", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps(),
});

export const products = pgTable(
  "products",
  {
    id: id(),
    slug: text("slug").notNull(),
    locale: text("locale").notNull().default(DEFAULT_LOCALE),
    name: text("name").notNull(),
    tagline: text("tagline"),
    websiteUrl: text("website_url").notNull(),
    /** Registrable domain, used for duplicate detection (FR-INT-4). */
    domain: text("domain").notNull(),
    logoAssetId: uuid("logo_asset_id"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    status: productStatus("status").notNull().default("draft"),
    /** Refresh cadence in days (FR-MNT-1). */
    refreshIntervalDays: smallint("refresh_interval_days").notNull().default(60),
    lastResearchedAt: timestamp("last_researched_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("products_slug_locale_uq").on(t.slug, t.locale),
    uniqueIndex("products_domain_locale_uq").on(t.domain, t.locale),
    index("products_category_idx").on(t.categoryId),
  ],
);

export const productTags = pgTable(
  "product_tags",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.tagId] })],
);

export const productSources = pgTable(
  "product_sources",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    kind: sourceKind("kind").notNull(),
    title: text("title"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    httpStatus: smallint("http_status"),
    robotsAllowed: boolean("robots_allowed"),
    contentMd: text("content_md"),
    contentHash: text("content_hash"),
    screenshotAssetId: uuid("screenshot_asset_id"),
    createdByJobId: uuid("created_by_job_id"),
    ...timestamps(),
  },
  (t) => [
    index("product_sources_product_idx").on(t.productId),
    uniqueIndex("product_sources_product_url_uq").on(t.productId, t.url),
  ],
);

/** Voyage `voyage-3` family outputs 1024-dimensional vectors. Changing the model means a new column + backfill. */
export const EMBEDDING_DIMENSIONS = 1024;

export const researchChunks = pgTable(
  "research_chunks",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => productSources.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    text: text("text").notNull(),
    tokenCount: integer("token_count"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("research_chunks_product_idx").on(t.productId),
    index("research_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const factSheets = pgTable(
  "fact_sheets",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    data: jsonb("data").$type<FactSheet>().notNull(),
    /** Field-level changes vs the previous version (FR-RES-9). */
    diffFromPrevious: jsonb("diff_from_previous").$type<Array<{ path: string; before: unknown; after: unknown }>>(),
    createdByJobId: uuid("created_by_job_id"),
    editedByUserId: text("edited_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fact_sheets_product_version_uq").on(t.productId, t.version)],
);

export const competitors = pgTable(
  "competitors",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    competitorProductId: uuid("competitor_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relation: competitorRelation("relation").notNull().default("alternative"),
    note: text("note"),
    position: real("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.competitorProductId] })],
);
