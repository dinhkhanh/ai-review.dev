import { randomBytes } from "node:crypto";
import { auditLog, eq, productSources, vaultSecrets } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createHandsOnSession,
  deleteSecret,
  findOrCreateProduct,
  finishHandsOnSession,
  getHandsOnSession,
  getSecret,
  handsOnEligibility,
  hasActiveHandsOnSession,
  listHandsOnSessions,
  listSecrets,
  openSecret,
  putSecret,
  recordHandsOnEvidence,
  rotateVault,
  sealSecret,
  setHandsOnOptIn,
  setSetting,
  startHandsOnSession,
  TEST_IDENTITY_SECRET,
  vaultKeyringFromEnv,
  type HandsOnFindings,
} from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
});

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const ring1 = vaultKeyringFromEnv({ VAULT_KEY: k1 })!;
const identity = { name: "Ada Tester", password: "correct horse battery staple" };

describe("vault (FR-RES-7)", () => {
  it("seals with AES-GCM bound to the name and rejects tampering or the wrong key", () => {
    const sealed = sealSecret({ password: "s3cret!" }, "a.b", ring1.current.key);
    expect(sealed).not.toContain("s3cret");
    expect(openSecret(sealed, "a.b", ring1.current.key)).toEqual({ password: "s3cret!" });
    expect(() => openSecret(sealed, "a.c", ring1.current.key)).toThrow(/could not be decrypted/);
    expect(() => openSecret(sealed, "a.b", Buffer.from(k2, "base64"))).toThrow(/could not be decrypted/);
    const bytes = Buffer.from(sealed, "base64");
    bytes[bytes.length - 1]! ^= 1;
    expect(() => openSecret(bytes.toString("base64"), "a.b", ring1.current.key)).toThrow();
  });

  it("parses single keys and rotation lists, and refuses bad keys", () => {
    expect(vaultKeyringFromEnv({})).toBeNull();
    const ring = vaultKeyringFromEnv({ VAULT_KEY: `2:${k2},1:${k1}` })!;
    expect(ring.current.version).toBe(2);
    expect([...ring.byVersion.keys()]).toEqual([2, 1]);
    expect(() => vaultKeyringFromEnv({ VAULT_KEY: "dG9vIHNob3J0" })).toThrow(/32 bytes/);
  });

  it("stores, lists without plaintext, decrypts, audits names only, rotates and deletes", async () => {
    await expect(
      putSecret(ctx.db, { name: TEST_IDENTITY_SECRET, kind: "test_identity", value: identity }, { keyring: null }),
    ).rejects.toThrow(/vault is disabled/i);
    await putSecret(
      ctx.db,
      { name: TEST_IDENTITY_SECRET, kind: "test_identity", value: identity, actorUserId: "u1" },
      { keyring: ring1 },
    );
    const listed = await listSecrets(ctx.db);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(identity.password);
    expect(listed[0]).not.toHaveProperty("ciphertext");
    const [raw] = await ctx.db.select().from(vaultSecrets);
    expect(raw!.ciphertext).not.toContain("horse");

    expect(await getSecret(ctx.db, TEST_IDENTITY_SECRET, { keyring: ring1 })).toEqual(identity);
    expect((await listSecrets(ctx.db))[0]!.lastUsedAt).not.toBeNull();
    expect(await getSecret(ctx.db, "missing", { keyring: ring1 })).toBeNull();

    const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "vault.put"));
    expect(JSON.stringify(audits)).not.toContain(identity.password);
    expect(audits[0]!.data).toMatchObject({ fields: ["name", "password"] });

    const ring2 = vaultKeyringFromEnv({ VAULT_KEY: `2:${k2},1:${k1}` })!;
    expect(await rotateVault(ctx.db, { keyring: ring2 })).toEqual({ rotated: 1 });
    expect(
      await getSecret(ctx.db, TEST_IDENTITY_SECRET, { keyring: vaultKeyringFromEnv({ VAULT_KEY: `2:${k2}` }) }),
    ).toEqual(identity);
    await expect(getSecret(ctx.db, TEST_IDENTITY_SECRET, { keyring: ring1 })).rejects.toThrow(/no version 2/);

    await deleteSecret(ctx.db, TEST_IDENTITY_SECRET);
    expect(await listSecrets(ctx.db)).toHaveLength(0);
  });
});

describe("hands-on sessions (FR-RES-7)", () => {
  const env = { VAULT_KEY: k1, HANDS_ON_INBOX_DOMAIN: "trials.example.com", RESEND_API_KEY: "re_x" };

  it("needs the global switch, the product opt-in and a test identity", async () => {
    const { product } = await findOrCreateProduct(ctx.db, { name: "Acme", websiteUrl: "https://acme.io" });
    let e = await handsOnEligibility(ctx.db, product.id, env);
    expect(e.eligible).toBe(false);
    expect(e.reasons.join(" ")).toMatch(/Settings/);
    expect(e.reasons.join(" ")).toMatch(/not opted in/);
    expect(e.reasons.join(" ")).toMatch(/No test identity/);

    await setSetting(ctx.db, "pipeline.handsOnTrials", true);
    await setHandsOnOptIn(ctx.db, product.id, true, "u1");
    await putSecret(ctx.db, { name: TEST_IDENTITY_SECRET, kind: "test_identity", value: identity }, { keyring: ring1 });
    e = await handsOnEligibility(ctx.db, product.id, env);
    expect(e).toEqual({ eligible: true, reasons: [], warnings: [] });

    e = await handsOnEligibility(ctx.db, product.id, { VAULT_KEY: k1 });
    expect(e.eligible).toBe(true);
    expect(e.warnings[0]).toMatch(/HANDS_ON_INBOX_DOMAIN/);
    expect((await handsOnEligibility(ctx.db, product.id, {})).reasons).toContain(
      "The vault is disabled (VAULT_KEY is not set)",
    );
  });

  it("tracks a session and turns findings into a first-party source that replaces the last one", async () => {
    const { product } = await findOrCreateProduct(ctx.db, { name: "Acme", websiteUrl: "https://acme.io" });
    const session = await createHandsOnSession(ctx.db, { productId: product.id });
    expect(await hasActiveHandsOnSession(ctx.db, product.id)).toBe(true);
    await startHandsOnSession(ctx.db, session.id);
    const findings: HandsOnFindings = {
      signedUp: true,
      planObserved: "14-day Pro trial",
      onboardingSteps: ["Email and password form", "Verify email by code", "Create first project"],
      timeToValueMinutes: 4,
      observedFeatures: ["Kanban board"],
      limits: ["Exports need the Business plan"],
      uiNotes: ["Clear empty states"],
      summary: "Sign-up took four minutes and the board worked straight away.",
    };
    await finishHandsOnSession(ctx.db, session.id, {
      status: "succeeded",
      actions: [{ ts: new Date().toISOString(), step: 1, action: "navigate", url: "https://acme.io/signup" }],
      findings,
      screenshotAssetIds: [],
      costUsd: 0.42,
    });
    expect(await hasActiveHandsOnSession(ctx.db, product.id)).toBe(false);
    const loaded = await getHandsOnSession(ctx.db, session.id);
    expect(loaded?.status).toBe("succeeded");
    expect(loaded?.productName).toBe("Acme");
    expect((await listHandsOnSessions(ctx.db, { productId: product.id }))[0]!.costUsd).toBe("0.420000");

    const source = await recordHandsOnEvidence(ctx.db, {
      productId: product.id,
      sessionId: session.id,
      findings,
      status: "succeeded",
      date: new Date("2026-10-11T10:00:00Z"),
    });
    expect(source.kind).toBe("official");
    expect(source.url).toBe("https://acme.io/#ai-review-hands-on");
    expect(source.contentMd).toContain("Hands-on trial of Acme by ai-review.dev (2026-10-11)");
    expect(source.contentMd).toContain("- Exports need the Business plan");
    await recordHandsOnEvidence(ctx.db, {
      productId: product.id,
      sessionId: session.id,
      findings: { ...findings, signedUp: false },
      status: "blocked",
      stopReason: "captcha",
    });
    const sources = await ctx.db.select().from(productSources).where(eq(productSources.productId, product.id));
    expect(sources).toHaveLength(1);
    expect(sources[0]!.contentMd).toContain("A CAPTCHA challenge appeared");
  });
});
