import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "./seed";
import { setupTestDb } from "./testing";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
  await ctx.reset();
});
afterAll(async () => ctx.close());

describe("migrations", () => {
  it("install pgvector and create the HNSW index on research chunks", async () => {
    const ext = await ctx.db.execute<{ extname: string }>(sql`select extname from pg_extension`);
    expect(ext.map((e) => e.extname)).toEqual(expect.arrayContaining(["vector", "pg_trgm", "citext"]));
    const idx = await ctx.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'research_chunks_embedding_idx'`,
    );
    expect(idx[0]?.indexdef).toContain("hnsw");
  });

  it("enforce the job step idempotency key", async () => {
    const [job] = await ctx.db.execute<{ id: string }>(
      sql`insert into review_jobs (preset, input) values ('quick_review', '{}') returning id`,
    );
    await ctx.db.execute(sql`insert into job_steps (job_id, name, attempt) values (${job!.id}, 'smoke', 1)`);
    await expect(
      ctx.db.execute(sql`insert into job_steps (job_id, name, attempt) values (${job!.id}, 'smoke', 1)`),
    ).rejects.toThrow();
  });

  it("seed is idempotent", async () => {
    await seed(ctx.db);
    await seed(ctx.db);
    const [row] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from categories`);
    expect(row?.n).toBe(6);
  });
});

describe("row-level security", () => {
  it("is enabled on every public table (blocks Supabase Data API access)", async () => {
    const rows = await ctx.db.execute<{ tablename: string }>(
      sql`select c.relname as tablename from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });
});
