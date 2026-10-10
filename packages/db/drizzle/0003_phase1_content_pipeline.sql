CREATE TYPE "public"."media_storage" AS ENUM('r2', 'db');--> statement-breakpoint
CREATE TABLE "article_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"version_id" uuid,
	"block_id" text,
	"body" text NOT NULL,
	"author_user_id" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "research_chunks" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;--> statement-breakpoint
ALTER TABLE "job_steps" ADD COLUMN "logs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "review_jobs" ADD COLUMN "article_id" uuid;--> statement-breakpoint
ALTER TABLE "article_versions" ADD COLUMN "fact_check" jsonb;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "brief" jsonb;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "storage" "media_storage" DEFAULT 'r2' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "article_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_comments_article_idx" ON "article_comments" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "research_chunks_tsv_idx" ON "research_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "research_chunks_source_ord_uq" ON "research_chunks" USING btree ("source_id","ord");--> statement-breakpoint
CREATE INDEX "media_assets_article_idx" ON "media_assets" USING btree ("article_id");--> statement-breakpoint
-- New tables get RLS like every other public table (see 0002_enable_rls.sql).
ALTER TABLE "article_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_blobs" ENABLE ROW LEVEL SECURITY;
