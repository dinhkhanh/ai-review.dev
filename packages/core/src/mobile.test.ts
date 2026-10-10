import type { FactSheet, QaScorecard } from "@repo/content";
import { devices, eq, priceChanges } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addArticleVersion,
  addPriceAlert,
  authenticateDevice,
  checkPushReceipts,
  createArticle,
  deleteDevice,
  describePriceChanges,
  diffPricing,
  ensureGoSlug,
  findOrCreateProduct,
  getDeviceSummary,
  listPriceAlerts,
  listSavedItems,
  mobileStats,
  publishArticle,
  recordPriceChange,
  registerDevice,
  removePriceAlert,
  saveArticle,
  sendExpoPush,
  sendPendingPriceAlerts,
  setSetting,
  transitionArticle,
  unsaveArticle,
  updateDevice,
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

const passing: QaScorecard = { hardGatesPassed: true, checks: [], computedAt: new Date().toISOString() };
const SITE = "https://ai-review.dev";

async function publishedReview(name: string, url: string) {
  const { product } = await findOrCreateProduct(ctx.db, { name, websiteUrl: url });
  await ensureGoSlug(ctx.db, product);
  const a = await createArticle(ctx.db, {
    type: "review",
    productId: product.id,
    title: `${name} review`,
    slug: `${product.slug}-review`,
  });
  await addArticleVersion(ctx.db, a.id, {
    blocks: [{ id: "v", type: "verdict", score: 8, summary: `${name} verdict`, bestFor: [], notFor: [] }],
    overallScore: 8,
    qaScorecard: passing,
  });
  await transitionArticle(ctx.db, a.id, "in_review");
  await transitionArticle(ctx.db, a.id, "approved");
  await publishArticle(ctx.db, a.id, { ignoreCap: true });
  return { product, article: a };
}

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

function sheet(tiers: Array<{ name: string; price: number | null; period?: string }>): FactSheet {
  return {
    name: "X",
    website: "https://x.example",
    features: [],
    pricing: {
      tiers: {
        value: tiers.map((t) => ({
          name: t.name,
          price: t.price,
          currency: "USD",
          period: (t.period ?? "month") as "month",
          limits: [],
          highlights: [],
        })),
        citations: [],
        confidence: "high",
      },
    },
  } as unknown as FactSheet;
}

/** Fake Expo endpoint: records requests and answers with the given tickets/receipts. */
function fakeExpo(answer: (body: unknown, url: string) => unknown) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(answer(body, url)), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchFn };
}

describe("devices (FR-API-4)", () => {
  it("registers anonymously, authenticates by token and rejects wrong secrets", async () => {
    const { deviceId, token } = await registerDevice(ctx.db, { platform: "ios", locale: "de" });
    const [row] = await ctx.db.select().from(devices).where(eq(devices.id, deviceId));
    expect(row!.secretHash).not.toContain(token.split(".")[1]);
    expect((await authenticateDevice(ctx.db, `Bearer ${token}`))?.id).toBe(deviceId);
    expect(await authenticateDevice(ctx.db, `Bearer ${deviceId}.${"x".repeat(43)}`)).toBeNull();
    expect(await authenticateDevice(ctx.db, `Bearer nonsense`)).toBeNull();
    expect(await authenticateDevice(ctx.db, null)).toBeNull();
    const summary = await getDeviceSummary(ctx.db, deviceId);
    expect(summary).toMatchObject({ platform: "ios", locale: "de", pushEnabled: false, savedCount: 0 });
  });

  it("moves a push token to the newest device and re-enables push", async () => {
    const a = await registerDevice(ctx.db, { platform: "ios", pushToken: TOKEN_A });
    const b = await registerDevice(ctx.db, { platform: "ios" });
    await updateDevice(ctx.db, b.deviceId, { pushToken: TOKEN_A });
    expect((await getDeviceSummary(ctx.db, a.deviceId)).pushEnabled).toBe(false);
    expect((await getDeviceSummary(ctx.db, b.deviceId)).pushEnabled).toBe(true);
    await updateDevice(ctx.db, b.deviceId, { pushToken: null });
    expect((await getDeviceSummary(ctx.db, b.deviceId)).pushEnabled).toBe(false);
  });

  it("saves live articles, lists them with URLs, unsaves, and deletes everything with the device", async () => {
    const { product, article } = await publishedReview("Notion", "https://notion.so");
    const { deviceId } = await registerDevice(ctx.db, { platform: "android" });
    await saveArticle(ctx.db, deviceId, { type: "review", slug: article.slug });
    await saveArticle(ctx.db, deviceId, { type: "review", slug: article.slug }); // idempotent
    await expect(saveArticle(ctx.db, deviceId, { type: "review", slug: "missing" })).rejects.toThrow("not found");
    const saved = await listSavedItems(ctx.db, deviceId, SITE);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      slug: article.slug,
      url: `${SITE}/reviews/${article.slug}`,
      productName: "Notion",
    });

    await addPriceAlert(ctx.db, deviceId, product.slug);
    expect((await listPriceAlerts(ctx.db, deviceId))[0]).toMatchObject({
      productName: "Notion",
      reviewSlug: article.slug,
    });
    expect((await getDeviceSummary(ctx.db, deviceId)).alertCount).toBe(1);

    await unsaveArticle(ctx.db, deviceId, article.id);
    expect(await listSavedItems(ctx.db, deviceId, SITE)).toHaveLength(0);
    await removePriceAlert(ctx.db, deviceId, product.slug);
    expect(await listPriceAlerts(ctx.db, deviceId)).toHaveLength(0);

    await saveArticle(ctx.db, deviceId, { type: "review", slug: article.slug });
    await deleteDevice(ctx.db, deviceId);
    expect((await mobileStats(ctx.db)).totals).toMatchObject({ devices: 0, saved: 0 });
  });
});

describe("price changes", () => {
  it("diffs plan prices, ignoring highlights, and describes them per locale", () => {
    const lines = diffPricing(
      sheet([
        { name: "Free", price: 0 },
        { name: "Pro", price: 10 },
        { name: "Team", price: 20 },
      ]),
      sheet([
        { name: "Free", price: 0 },
        { name: "pro", price: 12 },
        { name: "Business", price: 30 },
      ]),
    );
    expect(lines.map((l) => [l.plan, l.kind])).toEqual([
      ["pro", "changed"],
      ["Business", "added"],
      ["Team", "removed"],
    ]);
    expect(describePriceChanges(lines)).toBe("pro: $10/mo → $12/mo; Business: $30/mo (new plan); Team: plan removed");
    expect(describePriceChanges(lines, "de").replace(/\s/g, " ")).toContain("12 $/Monat");
    expect(diffPricing(null, sheet([{ name: "Pro", price: 1 }]))).toEqual([]);
  });

  it("pushes pending changes once, respects the daily cap and disables unregistered devices", async () => {
    const { product, article } = await publishedReview("Notion", "https://notion.so");
    const a = await registerDevice(ctx.db, { platform: "ios", pushToken: TOKEN_A, locale: "de" });
    const b = await registerDevice(ctx.db, { platform: "android", pushToken: TOKEN_B });
    const silent = await registerDevice(ctx.db, { platform: "ios" });
    for (const d of [a, b, silent]) await addPriceAlert(ctx.db, d.deviceId, product.slug);
    await setSetting(ctx.db, "mobile.push", { priceAlerts: true, maxPerDevicePerDay: 1 });

    const lines = diffPricing(sheet([{ name: "Pro", price: 10 }]), sheet([{ name: "Pro", price: 12 }]));
    const first = await recordPriceChange(ctx.db, { productId: product.id, jobId: null, lines });
    expect(first).not.toBeNull();

    const expo = fakeExpo((body) =>
      Array.isArray(body)
        ? {
            data: body.map((m: { to: string }) =>
              m.to === TOKEN_B
                ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
                : { status: "ok", id: `ticket-${m.to.slice(18, 19)}` },
            ),
          }
        : {},
    );
    const env = { siteUrl: SITE, accessToken: "tok" };
    const res = await sendPendingPriceAlerts(ctx.db, { env, fetch: expo.fetch });
    expect(res).toMatchObject({ changes: 1, sent: 1, failed: 1, capped: 0 });
    expect(res.tickets).toEqual([{ ticketId: "ticket-a", deviceId: a.deviceId }]);
    const message = (expo.calls[0]!.body as Array<Record<string, unknown>>).find((m) => m.to === TOKEN_A)!;
    expect(message.title).toBe("Preisänderung bei Notion");
    expect(message.data).toMatchObject({
      url: `aireview://reviews/${article.slug}?locale=de`,
      webUrl: `${SITE}/de/reviews/${article.slug}`,
    });
    expect(expo.calls[0]!.headers.Authorization).toBe("Bearer tok");
    expect((await getDeviceSummary(ctx.db, b.deviceId)).pushEnabled).toBe(false);

    // Nothing pending: a second run sends nothing.
    expect((await sendPendingPriceAlerts(ctx.db, { env, fetch: expo.fetch })).changes).toBe(0);

    // Another change the same day hits the cap of 1 for device A.
    await recordPriceChange(ctx.db, { productId: product.id, lines });
    const capped = await sendPendingPriceAlerts(ctx.db, { env, fetch: expo.fetch });
    expect(capped).toMatchObject({ changes: 1, sent: 0, capped: 1 });

    const [row] = await ctx.db.select().from(priceChanges).where(eq(priceChanges.id, first!.id));
    expect(row).toMatchObject({ pushSent: 1, pushFailed: 1 });
  });

  it("is idempotent per job and skips when alerts are off", async () => {
    const { product } = await publishedReview("Coda", "https://coda.io");
    const lines = diffPricing(sheet([{ name: "Pro", price: 10 }]), sheet([{ name: "Pro", price: 8 }]));
    const jobId = "00000000-0000-4000-8000-000000000001";
    const one = await recordPriceChange(ctx.db, { productId: product.id, jobId, lines });
    const two = await recordPriceChange(ctx.db, { productId: product.id, jobId, lines });
    expect(two!.id).toBe(one!.id);
    expect(await recordPriceChange(ctx.db, { productId: product.id, lines: [] })).toBeNull();
    await setSetting(ctx.db, "mobile.push", { priceAlerts: false, maxPerDevicePerDay: 3 });
    expect((await sendPendingPriceAlerts(ctx.db, { env: { siteUrl: SITE } })).skipped).toBe("disabled");
  });

  it("checks receipts and disables gone devices; chunks sends by 100", async () => {
    const a = await registerDevice(ctx.db, { platform: "ios", pushToken: TOKEN_A });
    const expo = fakeExpo(() => ({
      data: { t1: { status: "ok" }, t2: { status: "error", message: "x", details: { error: "DeviceNotRegistered" } } },
    }));
    const r = await checkPushReceipts(
      ctx.db,
      [
        { ticketId: "t1", deviceId: a.deviceId },
        { ticketId: "t2", deviceId: a.deviceId },
        { ticketId: "t3", deviceId: a.deviceId },
      ],
      { env: {}, fetch: expo.fetch },
    );
    expect(r).toEqual({ ok: 1, errors: 1, disabled: 1, pending: 1 });
    expect((await getDeviceSummary(ctx.db, a.deviceId)).pushEnabled).toBe(false);

    const many = fakeExpo((body) => ({ data: (body as unknown[]).map((_, i) => ({ status: "ok", id: `t${i}` })) }));
    const tickets = await sendExpoPush(
      Array.from({ length: 150 }, () => ({ to: TOKEN_A, title: "t", body: "b" })),
      { env: {}, fetch: many.fetch },
    );
    expect(many.calls.map((c) => (c.body as unknown[]).length)).toEqual([100, 50]);
    expect(tickets).toHaveLength(150);
  });
});
