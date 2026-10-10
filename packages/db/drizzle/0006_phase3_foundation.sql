CREATE TYPE "public"."hands_on_status" AS ENUM('queued', 'running', 'succeeded', 'blocked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('running', 'stopped', 'completed');--> statement-breakpoint
CREATE TYPE "public"."newsletter_issue_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'failed');--> statement-breakpoint
ALTER TYPE "public"."job_preset" ADD VALUE 'translate';--> statement-breakpoint
ALTER TYPE "public"."job_preset" ADD VALUE 'hands_on';--> statement-breakpoint
CREATE TABLE "hands_on_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"job_id" uuid,
	"status" "hands_on_status" DEFAULT 'queued' NOT NULL,
	"stop_reason" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"findings" jsonb,
	"screenshot_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"product_id" uuid,
	"ciphertext" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"description" text,
	"created_by_user_id" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "experiment_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"winner_link_id" uuid,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"subject" text NOT NULL,
	"intro" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "newsletter_issue_status" DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipients" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_console_daily" (
	"day" date NOT NULL,
	"page" text NOT NULL,
	"article_id" uuid,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position" real
);
--> statement-breakpoint
CREATE TABLE "search_console_queries" (
	"page" text NOT NULL,
	"query" text NOT NULL,
	"article_id" uuid,
	"window_end" date NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position" real
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_hash" text NOT NULL,
	"platform" text NOT NULL,
	"push_token" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"app_version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"job_id" uuid,
	"summary" text NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"push_sent" integer DEFAULT 0 NOT NULL,
	"push_failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" drop column "search_tsv";--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector(case when "locale" = 'de' then 'german'::regconfig else 'english'::regconfig end, coalesce("title", '')), 'A') || setweight(to_tsvector(case when "locale" = 'de' then 'german'::regconfig else 'english'::regconfig end, coalesce("search_text", '')), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "hands_on_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "translation_of_id" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "translated_from_version_id" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "decay_detected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "decay_signal" jsonb;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD COLUMN "experiment_id" uuid;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN "experiment_id" uuid;--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "conversions" ADD COLUMN "link_id" uuid;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN "last_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "hands_on_sessions" ADD CONSTRAINT "hands_on_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hands_on_sessions" ADD CONSTRAINT "hands_on_sessions_job_id_review_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."review_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_secrets" ADD CONSTRAINT "vault_secrets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_experiments" ADD CONSTRAINT "affiliate_experiments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_deliveries_issue_id_newsletter_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."newsletter_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_deliveries_subscriber_id_newsletter_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."newsletter_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hands_on_sessions_product_idx" ON "hands_on_sessions" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_secrets_name_uq" ON "vault_secrets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "vault_secrets_product_idx" ON "vault_secrets" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "affiliate_experiments_product_idx" ON "affiliate_experiments" USING btree ("product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_deliveries_issue_sub_uq" ON "newsletter_deliveries" USING btree ("issue_id","subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_issues_locale_period_uq" ON "newsletter_issues" USING btree ("locale","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_daily_day_page_uq" ON "search_console_daily" USING btree ("day","page");--> statement-breakpoint
CREATE INDEX "search_console_daily_article_idx" ON "search_console_daily" USING btree ("article_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_queries_page_query_uq" ON "search_console_queries" USING btree ("page","query");--> statement-breakpoint
CREATE INDEX "search_console_queries_article_idx" ON "search_console_queries" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_secret_hash_uq" ON "devices" USING btree ("secret_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_push_token_uq" ON "devices" USING btree ("push_token");--> statement-breakpoint
CREATE UNIQUE INDEX "price_alerts_device_product_uq" ON "price_alerts" USING btree ("device_id","product_id");--> statement-breakpoint
CREATE INDEX "price_alerts_product_idx" ON "price_alerts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "price_changes_product_idx" ON "price_changes" USING btree ("product_id","detected_at");--> statement-breakpoint
CREATE INDEX "price_changes_pending_idx" ON "price_changes" USING btree ("notified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_items_device_article_uq" ON "saved_items" USING btree ("device_id","article_id");--> statement-breakpoint
CREATE INDEX "articles_translation_of_idx" ON "articles" USING btree ("translation_of_id");--> statement-breakpoint
CREATE INDEX "affiliate_links_experiment_idx" ON "affiliate_links" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "conversions_link_idx" ON "conversions" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "articles_search_tsv_idx" ON "articles" USING gin ("search_tsv");--> statement-breakpoint
ALTER TABLE "hands_on_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vault_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "affiliate_experiments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_console_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_console_queries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_items" ENABLE ROW LEVEL SECURITY;
