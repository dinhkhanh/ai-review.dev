import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CreateDbOptions {
  /** Max pool size. Keep small on serverless (Vercel) and behind a pooler (Supabase :6543). */
  max?: number;
  /** Supabase transaction pooler does not support prepared statements. */
  prepare?: boolean;
}

export function createDb(url: string, options: CreateDbOptions = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    prepare: options.prepare ?? true,
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
    globalForDb.__aiReviewDb = createDb(url, {
      max: process.env.VERCEL ? 1 : 10,
      prepare: !url.includes(":6543"),
    });
  }
  return globalForDb.__aiReviewDb.db;
}
