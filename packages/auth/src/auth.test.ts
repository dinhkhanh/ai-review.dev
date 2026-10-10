import { auditLog, eq, users } from "@repo/db";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
let auth: ReturnType<typeof createAuth>;

beforeAll(async () => {
  ctx = await setupTestDb();
  auth = createAuth({ db: ctx.db, secret: "test-secret-test-secret-test-secret-32", baseURL: "http://localhost:3001" });
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

describe("createAuth", () => {
  it("refuses public sign-up", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "x@example.com", password: "a-long-password-123", name: "X" } }),
    ).rejects.toThrow();
  });

  it("lets a server-created admin sign in, stores the role, and audits the session", async () => {
    await auth.api.createUser({
      body: { email: "admin@example.com", password: "a-long-password-123", name: "Admin", role: "admin" },
    });
    const [user] = await ctx.db.select().from(users).where(eq(users.email, "admin@example.com"));
    expect(user?.role).toBe("admin");
    expect(user?.twoFactorEnabled).toBe(false);

    const res = await auth.api.signInEmail({ body: { email: "admin@example.com", password: "a-long-password-123" } });
    expect(res.token).toBeTruthy();

    const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.actorUserId, user!.id));
    expect(audits.map((a) => a.action)).toContain("auth.session_created");
  });

  it("rejects a wrong password and short passwords", async () => {
    await auth.api.createUser({ body: { email: "e@example.com", password: "a-long-password-123", name: "E" } });
    await expect(
      auth.api.signInEmail({ body: { email: "e@example.com", password: "wrong-password-123" } }),
    ).rejects.toThrow();
    await expect(
      auth.api.createUser({ body: { email: "f@example.com", password: "short", name: "F" } }),
    ).rejects.toThrow();
  });
});
