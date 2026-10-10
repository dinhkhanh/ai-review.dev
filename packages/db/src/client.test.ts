import { describe, expect, it } from "vitest";
import { isTransactionPooler, poolOptionsFor } from "./client";

const pooler = "postgres://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const session = "postgres://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
const local = "postgres://aireview:aireview@localhost:55432/aireview";

describe("poolOptionsFor", () => {
  it("disables pipelining and prepared statements behind the transaction pooler", () => {
    expect(isTransactionPooler(pooler)).toBe(true);
    expect(poolOptionsFor(pooler, { VERCEL: "1" })).toEqual({ max: 5, prepare: false, maxPipeline: 1 });
  });
  it("keeps defaults for direct and session-mode connections", () => {
    expect(isTransactionPooler(session)).toBe(false);
    expect(poolOptionsFor(session)).toEqual({ max: 10, prepare: true, maxPipeline: 100 });
    expect(poolOptionsFor(local)).toEqual({ max: 10, prepare: true, maxPipeline: 100 });
  });
});
