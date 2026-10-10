import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { products } from "./catalog";

export const jobPreset = pgEnum("job_preset", [
  "full_review",
  "quick_review",
  "comparison",
  "alternatives",
  "best_of",
  "refresh",
  /** Phase 3: translate a published article into another locale. */
  "translate",
  /** Phase 3: standalone hands-on trial session for an opted-in product (FR-RES-7). */
  "hands_on",
]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
]);
export const stepStatus = pgEnum("step_status", ["pending", "running", "succeeded", "failed", "skipped", "stale"]);
export const suggestionStatus = pgEnum("suggestion_status", ["new", "accepted", "dismissed"]);

export const reviewJobs = pgTable(
  "review_jobs",
  {
    id: id(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    preset: jobPreset("preset").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    /** Raw intake (FR-INT-1): name, url, angle, keywords, competitors... */
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    requestedByUserId: text("requested_by_user_id"),
    costCeilingUsd: numeric("cost_ceiling_usd", { precision: 12, scale: 6 }),
    totalCostUsd: numeric("total_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    /** Orchestrator run id (Trigger.dev) for deep links from the CMS. */
    runId: text("run_id"),
    /** The article this job produced or refreshed. */
    articleId: uuid("article_id"),
    /** Groups jobs created by one bulk submission (FR-INT-2). */
    batchId: uuid("batch_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    index("review_jobs_status_idx").on(t.status),
    index("review_jobs_product_idx").on(t.productId),
    index("review_jobs_batch_idx").on(t.batchId),
  ],
);

export const jobSteps = pgTable(
  "job_steps",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => reviewJobs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: stepStatus("status").notNull().default("pending"),
    input: jsonb("input"),
    output: jsonb("output"),
    model: text("model"),
    effort: text("effort"),
    promptVersion: text("prompt_version"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    error: text("error"),
    /** Structured log lines written by the step (FR-CMS-3). */
    logs: jsonb("logs")
      .$type<Array<{ ts: string; message: string; data?: Record<string, unknown> }>>()
      .notNull()
      .default([]),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps(),
  },
  // Idempotency key (NFR-4): a step never runs twice for the same (job, name, attempt).
  (t) => [uniqueIndex("job_steps_job_name_attempt_uq").on(t.jobId, t.name, t.attempt)],
);

/** Every paid API call (constraint C-4, FR-ANL-3). */
export const costLedger = pgTable(
  "cost_ledger",
  {
    id: id(),
    jobId: uuid("job_id").references(() => reviewJobs.id, { onDelete: "set null" }),
    stepId: uuid("step_id").references(() => jobSteps.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model"),
    operation: text("operation").notNull(),
    units: numeric("units", { precision: 14, scale: 2 }).notNull(),
    unitType: text("unit_type").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cost_ledger_job_idx").on(t.jobId), index("cost_ledger_created_idx").on(t.createdAt)],
);

/** Versioned prompts (constraint C-5). Repo files are the default; DB rows are CMS edits. */
export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: id(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    modelDefault: text("model_default"),
    effortDefault: text("effort_default"),
    active: boolean("active").notNull().default(false),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prompt_templates_key_version_uq").on(t.key, t.version)],
);

/** Product sourcing queue (FR-INT-7). */
export const productSuggestions = pgTable(
  "product_suggestions",
  {
    id: id(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    categorySlug: text("category_slug"),
    source: text("source").notNull(),
    /** Expected-value score used for ranking; higher first. */
    score: numeric("score", { precision: 8, scale: 3 }).notNull().default("0"),
    signals: jsonb("signals").$type<Record<string, unknown>>().notNull().default({}),
    status: suggestionStatus("status").notNull().default("new"),
    jobId: uuid("job_id").references(() => reviewJobs.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("product_suggestions_domain_uq").on(t.domain),
    index("product_suggestions_status_score_idx").on(t.status, t.score),
  ],
);

/** Prompt eval runs on the golden set (docs/plan.md §5 "Evals"). */
export const evalRuns = pgTable(
  "eval_runs",
  {
    id: id(),
    suite: text("suite").notNull(),
    /** Prompt versions under test, e.g. { write: "repo:v3", fact_check: "db:5" }. */
    promptVersions: jsonb("prompt_versions").$type<Record<string, string>>().notNull().default({}),
    status: text("status").notNull().default("running"),
    /** Per-case results: [{ case, passed, score, checks: [...] }]. */
    results: jsonb("results").$type<Array<Record<string, unknown>>>().notNull().default([]),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("eval_runs_suite_idx").on(t.suite, t.startedAt)],
);

/**
 * Encrypted credential vault (FR-RES-7). Values are AES-256-GCM ciphertext under `VAULT_KEY`
 * (env, never stored); plaintext never reaches logs, job outputs or the CMS after entry.
 */
export const vaultSecrets = pgTable(
  "vault_secrets",
  {
    id: id(),
    /** Stable lookup name, e.g. "test_identity.default" or "product.<slug>.login". */
    name: text("name").notNull(),
    /** "test_identity" (shared sign-up persona) or "product_credential". */
    kind: text("kind").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    /** base64(iv | authTag | ciphertext) of a JSON object. */
    ciphertext: text("ciphertext").notNull(),
    /** Key version, so `VAULT_KEY` can be rotated. */
    keyVersion: integer("key_version").notNull().default(1),
    /** Non-secret description shown in the CMS (e.g. which fields the JSON holds). */
    description: text("description"),
    createdByUserId: text("created_by_user_id"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("vault_secrets_name_uq").on(t.name), index("vault_secrets_product_idx").on(t.productId)],
);

export const handsOnStatus = pgEnum("hands_on_status", [
  "queued",
  "running",
  "succeeded",
  /** Stopped by a guardrail (payment wall, captcha, phone verification, ToS) — not an error. */
  "blocked",
  "failed",
]);

/** One browser-agent trial session (FR-RES-7): action log, in-app screenshots and notes. */
export const handsOnSessions = pgTable(
  "hands_on_sessions",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => reviewJobs.id, { onDelete: "set null" }),
    status: handsOnStatus("status").notNull().default("queued"),
    /** Why the agent stopped (guardrail name or error summary). */
    stopReason: text("stop_reason"),
    /** Ordered action log: [{ ts, action, target?, url?, note? }]; secrets are redacted. */
    actions: jsonb("actions").$type<Array<Record<string, unknown>>>().notNull().default([]),
    /** Structured findings for the fact sheet/writer: { onboarding, observations[], limits[] ... }. */
    findings: jsonb("findings").$type<Record<string, unknown>>(),
    screenshotAssetIds: uuid("screenshot_asset_ids").array().notNull().default([]),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("hands_on_sessions_product_idx").on(t.productId, t.createdAt)],
);
