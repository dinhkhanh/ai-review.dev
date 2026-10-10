CREATE TYPE "public"."notification_severity" AS ENUM('info', 'success', 'warning', 'error');--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite" text NOT NULL,
	"prompt_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversion_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" "affiliate_network",
	"source" text NOT NULL,
	"filename" text,
	"rows" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unmatched" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"program_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"code" text,
	"discount_text" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helpful_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"helpful" boolean NOT NULL,
	"ip_hash" text NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"severity" "notification_severity" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"entity_type" text,
	"entity_id" text,
	"dedupe_key" text,
	"delivery" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_views_daily" (
	"day" date NOT NULL,
	"path" text NOT NULL,
	"article_id" uuid,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "next_refresh_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "discontinued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status_note" text;--> statement-breakpoint
ALTER TABLE "review_jobs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "social" jsonb;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "search_text" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("search_text", '')), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "parent_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "voice_id" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "captions" jsonb;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD COLUMN "health_failures" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD COLUMN "final_url" text;--> statement-breakpoint
ALTER TABLE "conversions" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "conversions" ADD COLUMN "placement" text;--> statement-breakpoint
ALTER TABLE "conversions" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN "token_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_program_id_affiliate_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."affiliate_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_suite_idx" ON "eval_runs" USING btree ("suite","started_at");--> statement-breakpoint
CREATE INDEX "deals_product_idx" ON "deals" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "deals_active_idx" ON "deals" USING btree ("active","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "helpful_votes_article_ip_day_uq" ON "helpful_votes" USING btree ("article_id","ip_hash","day");--> statement-breakpoint
CREATE INDEX "helpful_votes_article_idx" ON "helpful_votes" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "page_views_daily_day_path_uq" ON "page_views_daily" USING btree ("day","path");--> statement-breakpoint
CREATE INDEX "page_views_daily_article_idx" ON "page_views_daily" USING btree ("article_id");--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_import_id_conversion_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."conversion_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_next_refresh_idx" ON "products" USING btree ("next_refresh_at");--> statement-breakpoint
CREATE INDEX "review_jobs_batch_idx" ON "review_jobs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "articles_search_tsv_idx" ON "articles" USING gin ("search_tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_article_kind_uq" ON "videos" USING btree ("article_id","kind");--> statement-breakpoint
CREATE INDEX "conversions_article_idx" ON "conversions" USING btree ("article_id");--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_token_unique" UNIQUE("token");--> statement-breakpoint
ALTER TABLE "eval_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversion_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "helpful_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_views_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Schedule the first refresh of already-researched products (FR-MNT-1).
UPDATE "products" SET "next_refresh_at" = "last_researched_at" + make_interval(days => "refresh_interval_days")
WHERE "last_researched_at" IS NOT NULL;
