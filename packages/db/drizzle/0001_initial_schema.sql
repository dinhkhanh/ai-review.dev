CREATE TYPE "public"."competitor_relation" AS ENUM('alternative', 'direct');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'discontinued', 'archived');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('official', 'aggregator', 'community', 'video', 'news', 'other');--> statement-breakpoint
CREATE TYPE "public"."job_preset" AS ENUM('full_review', 'quick_review', 'comparison', 'alternatives', 'best_of', 'refresh');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped', 'stale');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('new', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."article_status" AS ENUM('draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."article_type" AS ENUM('review', 'comparison', 'alternatives', 'best_of');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('image', 'screenshot', 'graphic', 'video', 'audio', 'logo');--> statement-breakpoint
CREATE TYPE "public"."media_origin" AS ENUM('generated', 'templated', 'captured', 'vendor', 'uploaded');--> statement-breakpoint
CREATE TYPE "public"."video_kind" AS ENUM('short', 'long');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('draft', 'rendering', 'ready', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."affiliate_network" AS ENUM('direct', 'partnerstack', 'impact', 'awin', 'shareasale', 'cj', 'rewardful', 'firstpromoter', 'tolt', 'lemonsqueezy', 'gumroad', 'appsumo', 'paddle', 'skimlinks', 'sovrn', 'amazon', 'other');--> statement-breakpoint
CREATE TYPE "public"."commission_model" AS ENUM('recurring_percent', 'one_time_percent', 'flat_per_sale', 'flat_per_lead', 'hybrid', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."conversion_status" AS ENUM('pending', 'approved', 'reversed', 'paid');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('pending', 'active', 'paused', 'broken');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('not_found', 'found', 'applied', 'approved', 'active', 'paused', 'rejected', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."redirect_policy" AS ENUM('allowed', 'forbidden', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT false,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"role" text DEFAULT 'editor',
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"position" smallint DEFAULT 0 NOT NULL,
	"rubric" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"product_id" uuid NOT NULL,
	"competitor_product_id" uuid NOT NULL,
	"relation" "competitor_relation" DEFAULT 'alternative' NOT NULL,
	"note" text,
	"position" real DEFAULT 0 NOT NULL,
	CONSTRAINT "competitors_product_id_competitor_product_id_pk" PRIMARY KEY("product_id","competitor_product_id")
);
--> statement-breakpoint
CREATE TABLE "fact_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"diff_from_previous" jsonb,
	"created_by_job_id" uuid,
	"edited_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"title" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_status" smallint,
	"robots_allowed" boolean,
	"content_md" text,
	"content_hash" text,
	"screenshot_asset_id" uuid,
	"created_by_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_tags" (
	"product_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "product_tags_product_id_tag_id_pk" PRIMARY KEY("product_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"website_url" text NOT NULL,
	"domain" text NOT NULL,
	"logo_asset_id" uuid,
	"category_id" uuid,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"refresh_interval_days" smallint DEFAULT 60 NOT NULL,
	"last_researched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"text" text NOT NULL,
	"token_count" integer,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cost_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"step_id" uuid,
	"provider" text NOT NULL,
	"model" text,
	"operation" text NOT NULL,
	"units" numeric(14, 2) NOT NULL,
	"unit_type" text NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"model" text,
	"effort" text,
	"prompt_version" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"category_slug" text,
	"source" text NOT NULL,
	"score" numeric(8, 3) DEFAULT '0' NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "suggestion_status" DEFAULT 'new' NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"model_default" text,
	"effort_default" text,
	"active" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"preset" "job_preset" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"requested_by_user_id" text,
	"cost_ceiling_usd" numeric(12, 6),
	"total_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"run_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"blocks" jsonb NOT NULL,
	"seo" jsonb,
	"overall_score" real,
	"qa_scorecard" jsonb,
	"prompt_versions" jsonb,
	"created_by_job_id" uuid,
	"created_by_user_id" text,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "article_type" NOT NULL,
	"slug" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"title" text NOT NULL,
	"status" "article_status" DEFAULT 'draft' NOT NULL,
	"product_id" uuid,
	"product_ids" uuid[] DEFAULT '{}' NOT NULL,
	"current_version_id" uuid,
	"author_id" uuid,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"avatar_asset_id" uuid,
	"user_id" text,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "media_kind" NOT NULL,
	"origin" "media_origin" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alt" text,
	"license_note" text,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"kind" "video_kind" NOT NULL,
	"status" "video_status" DEFAULT 'draft' NOT NULL,
	"script" jsonb,
	"audio_asset_id" uuid,
	"video_asset_id" uuid,
	"thumbnail_asset_id" uuid,
	"youtube_id" text,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"program_id" uuid,
	"label" text NOT NULL,
	"destination_url" text NOT NULL,
	"region" text DEFAULT 'global' NOT NULL,
	"status" "link_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"last_health_check_at" timestamp with time zone,
	"health_detail" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"network" "affiliate_network" NOT NULL,
	"name" text NOT NULL,
	"status" "program_status" DEFAULT 'found' NOT NULL,
	"commission_model" "commission_model" DEFAULT 'unknown' NOT NULL,
	"commission_value" numeric(10, 2),
	"commission_currency" text DEFAULT 'USD',
	"recurring_months" smallint,
	"cookie_days" smallint,
	"signup_url" text,
	"dashboard_url" text,
	"terms_url" text,
	"link_format" jsonb,
	"redirect_policy" "redirect_policy" DEFAULT 'unknown' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft_application" text,
	"applied_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"go_slug" text NOT NULL,
	"link_id" uuid,
	"article_id" uuid,
	"placement" text,
	"path" text,
	"country" text,
	"device" text,
	"ip_hash" text,
	"ua_hash" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"fallback" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" "affiliate_network" NOT NULL,
	"program_id" uuid,
	"sub_id" text,
	"article_id" uuid,
	"external_order_id" text,
	"amount" numeric(12, 2),
	"commission" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "conversion_status" DEFAULT 'pending' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "go_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"fallback_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"data" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid,
	"product_id" uuid,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"email" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_competitor_product_id_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_sheets" ADD CONSTRAINT "fact_sheets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_chunks" ADD CONSTRAINT "research_chunks_source_id_product_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."product_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_chunks" ADD CONSTRAINT "research_chunks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_job_id_review_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."review_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_step_id_job_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."job_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_review_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."review_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suggestions" ADD CONSTRAINT "product_suggestions_job_id_review_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."review_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_jobs" ADD CONSTRAINT "review_jobs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_program_id_affiliate_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."affiliate_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_programs" ADD CONSTRAINT "affiliate_programs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_program_id_affiliate_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."affiliate_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "go_slugs" ADD CONSTRAINT "go_slugs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_sheets_product_version_uq" ON "fact_sheets" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "product_sources_product_idx" ON "product_sources" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_sources_product_url_uq" ON "product_sources" USING btree ("product_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_locale_uq" ON "products" USING btree ("slug","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "products_domain_locale_uq" ON "products" USING btree ("domain","locale");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "research_chunks_product_idx" ON "research_chunks" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "research_chunks_embedding_idx" ON "research_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "cost_ledger_job_idx" ON "cost_ledger" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_created_idx" ON "cost_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_steps_job_name_attempt_uq" ON "job_steps" USING btree ("job_id","name","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "product_suggestions_domain_uq" ON "product_suggestions" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "product_suggestions_status_score_idx" ON "product_suggestions" USING btree ("status","score");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_templates_key_version_uq" ON "prompt_templates" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "review_jobs_status_idx" ON "review_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "review_jobs_product_idx" ON "review_jobs" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_versions_article_version_uq" ON "article_versions" USING btree ("article_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_type_slug_locale_uq" ON "articles" USING btree ("type","slug","locale");--> statement-breakpoint
CREATE INDEX "articles_status_idx" ON "articles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "articles_product_idx" ON "articles" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "media_assets_product_idx" ON "media_assets" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "affiliate_links_product_status_idx" ON "affiliate_links" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "affiliate_programs_product_idx" ON "affiliate_programs" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "affiliate_programs_status_idx" ON "affiliate_programs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clicks_ts_idx" ON "clicks" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "clicks_slug_ts_idx" ON "clicks" USING btree ("go_slug","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "conversions_network_order_uq" ON "conversions" USING btree ("network","external_order_id");--> statement-breakpoint
CREATE INDEX "conversions_subid_idx" ON "conversions" USING btree ("sub_id");--> statement-breakpoint
CREATE INDEX "conversions_occurred_idx" ON "conversions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");