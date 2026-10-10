import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CreateDbOptions {
  /** Max pool size. */
  max?: number;
  /** Supabase transaction pooler does not support prepared statements. */
  prepare?: boolean;
  /** Max queries in flight per connection. 1 disables pipelining. */
  maxPipeline?: number;
}

/** True for a Supabase transaction-mode pooler URL (Supavisor, port 6543). */
export function isTransactionPooler(url: string): boolean {
  try {
    return new URL(url).port === "6543";
  } catch {
    return false;
  }
}

/**
 * Pool settings per environment. Behind Supabase's transaction pooler, postgres.js must not
 * pipeline: concurrent queries pipelined on one connection hang forever (verified against
 * production; Next.js renders layouts and pages in parallel, so this happens on most pages).
 * Prepared statements are also unsupported there.
 */
export function poolOptionsFor(url: string, env: { VERCEL?: string } = {}): Required<CreateDbOptions> {
  const pooler = isTransactionPooler(url);
  return {
    // Vercel Fluid compute shares one instance (and this pool) across concurrent requests.
    max: env.VERCEL ? 5 : 10,
    prepare: !pooler,
    maxPipeline: pooler ? 1 : 100,
  };
}

export function createDb(url: string, options: CreateDbOptions = {}) {
  const defaults = poolOptionsFor(url);
  const client = postgres(url, {
    max: options.max ?? defaults.max,
    prepare: options.prepare ?? defaults.prepare,
    // Not in postgres.js typings, but supported (src/index.js); see poolOptionsFor.
    ...({ max_pipeline: options.maxPipeline ?? defaults.maxPipeline } as object),
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}

const globalForDb = globalThis as unknown as { __aiReviewDb?: ReturnType<typeof createDb> };

/**
 * Process-wide database handle from DATABASE_URL. Cached on globalThis so Next.js dev
 * hot reloads do not leak connection pools.
 */
export function getDb(): Database {
  if (!globalForDb.__aiReviewDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and run `pnpm db:up`.");
    globalForDb.__aiReviewDb = createDb(url, poolOptionsFor(url, { VERCEL: process.env.VERCEL }));
  }
  return globalForDb.__aiReviewDb.db;
}
