import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { createDb, type Database } from "./client";
import { runMigrations } from "./migrate";

/**
 * Each workspace package gets its own test database (`<TEST_DATABASE_URL db>_<package>`), because
 * Turborepo runs package test tasks in parallel and a shared database would let one package's
 * `reset()` truncate another's rows mid-test.
 */
async function ensurePackageDatabase(baseUrl: string): Promise<string> {
  // Vitest runs with the package directory as cwd.
  let pkgName = "default";
  try {
    pkgName = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).name ?? pkgName;
  } catch {
    // fall back to a shared database
  }
  const pkg = pkgName
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
  const url = new URL(baseUrl);
  const name = `${url.pathname.slice(1)}_${pkg}`.slice(0, 63);
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  try {
    const exists = await admin`select 1 from pg_database where datname = ${name}`;
    if (exists.length === 0) {
      try {
        await admin.unsafe(`create database "${name}"`);
      } catch (error) {
        // Another process created it first.
        if (!String(error).includes("already exists")) throw error;
      }
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * Test helper: migrates this package's test database once per process and returns a handle plus
 * `reset()`, which truncates every application table. Never points at DATABASE_URL.
 */
export async function setupTestDb(): Promise<{ db: Database; reset: () => Promise<void>; close: () => Promise<void> }> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  if (base === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
  const url = await ensurePackageDatabase(base);
  await runMigrations(url);
  const { db, close } = createDb(url, { max: 2 });
  const reset = async () => {
    const rows = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`,
    );
    const names = rows.map((r) => `"${r.tablename}"`).join(", ");
    if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
  };
  return { db, reset, close };
}
