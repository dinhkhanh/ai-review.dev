import { articles, categories, eq, users } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateReadiness, findOrCreateProduct, REQUIRED_CMS_ENV, setSetting, type ReadinessReport } from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
});

const SITE = "https://site.test";
const fullEnv = Object.fromEntries(
  [
    ...REQUIRED_CMS_ENV.flatMap((e) => e.vars),
    "SENTRY_DSN",
    "RESEND_API_KEY",
    "NOTIFY_EMAIL_FROM",
    "VOYAGE_API_KEY",
    "GSC_CLIENT_EMAIL",
    "GSC_PRIVATE_KEY",
    "GSC_SITE_URL",
  ].map((k) => [k, k === "NEXT_PUBLIC_SITE_URL" ? SITE : "x"]),
);

/** Fake site: every page 200 unless listed; the Impressum is noindex unless `impressumOk`. */
function site(opts: { status?: Record<string, number>; impressumOk?: boolean; down?: boolean } = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    if (opts.down) throw new TypeError("fetch failed");
    const path = new URL(String(input)).pathname;
    const status = opts.status?.[path] ?? 200;
    const robots = path === "/impressum" && !opts.impressumOk ? '<meta name="robots" content="noindex, follow"/>' : "";
    return new Response(`<html><head>${robots}</head><body>ok</body></html>`, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;
}

const item = (r: ReadinessReport, id: string) => r.groups.flatMap((g) => g.items).find((i) => i.id === id)!;

async function staff(email: string, role: "admin" | "editor", twoFactorEnabled: boolean) {
  await ctx.db.insert(users).values({ id: email, name: email, email, role, twoFactorEnabled });
}

describe("evaluateReadiness", () => {
  it("reports missing env, accounts without 2FA and unreachable pages", async () => {
    await staff("a@x.dev", "admin", true);
    await staff("e@x.dev", "editor", false);
    const r = await evaluateReadiness(ctx.db, { NEXT_PUBLIC_SITE_URL: SITE }, { fetch: site({ down: true }) });
    expect(item(r, "env.database").status).toBe("fail");
    expect(item(r, "env.revalidate").detail).toContain("REVALIDATE_SECRET");
    expect(item(r, "env.revalidate").detail).not.toContain("NEXT_PUBLIC_SITE_URL");
    expect(item(r, "env.sentry").status).toBe("warn");
    expect(item(r, "env.notify_channel").status).toBe("warn");
    expect(item(r, "people.admin").status).toBe("pass");
    expect(item(r, "people.2fa")).toMatchObject({ status: "fail", evidence: { notEnrolled: ["e@x.dev"] } });
    expect(item(r, "site.health").status).toBe("warn");
    expect(item(r, "site.affiliate_disclosure").detail).toContain("Could not reach");
    expect(r.summary.fail).toBeGreaterThan(0);
  });

  it("passes a configured launch setup and checks seeded settings against the SRS §9 decisions", async () => {
    await staff("a@x.dev", "admin", true);
    await setSetting(ctx.db, "notifications.recipients", ["a@x.dev"]);
    await setSetting(ctx.db, "affiliate.catchAllFallback", { enabled: true, network: "skimlinks", publisherId: "123" });
    const r = await evaluateReadiness(ctx.db, fullEnv, { fetch: site() });
    for (const g of r.groups.filter((g) => ["env", "people", "settings", "site"].includes(g.id)))
      for (const i of g.items) expect(i.status, `${i.id}: ${i.detail}`).toBe("pass");
    // Seeded categories exist but have no published reviews yet; German is not public.
    expect(item(r, "content.category.ai-tools").status).toBe("warn");
    expect(item(r, "content.published").status).toBe("warn");
    expect(item(r, "de.public").status).toBe("n/a");
  });

  it("flags settings that break D-3, D-4, D-7, the AI disclosure and the hands-on vault", async () => {
    await setSetting(ctx.db, "publishing.requireHumanReview", false);
    await setSetting(ctx.db, "publishing.dailyCap", 20);
    await setSetting(ctx.db, "editorial.aiDisclosure", " ");
    await setSetting(ctx.db, "affiliate.catchAllFallback", { enabled: false, network: null });
    await setSetting(ctx.db, "costs.defaultCeilingUsd", null);
    await setSetting(ctx.db, "pipeline.handsOnTrials", true);
    const r = await evaluateReadiness(ctx.db, fullEnv, { fetch: site() });
    expect(item(r, "settings.human_review").status).toBe("fail");
    expect(item(r, "settings.daily_cap").status).toBe("warn");
    expect(item(r, "settings.ai_disclosure").status).toBe("fail");
    expect(item(r, "settings.catch_all").detail).toContain("Disabled");
    expect(item(r, "settings.cost_ceiling").status).toBe("warn");
    expect(item(r, "settings.hands_on").status).toBe("fail");
    expect(item(r, "settings.recipients").status).toBe("warn");
    expect(item(r, "people.2fa").detail).toBe("No CMS accounts.");
  });

  it("counts published reviews per launch category and flags a missing category", async () => {
    const [ai] = await ctx.db.select().from(categories).where(eq(categories.slug, "ai-tools"));
    const { product } = await findOrCreateProduct(ctx.db, {
      name: "Acme",
      websiteUrl: "https://acme.dev",
      categoryId: ai!.id,
    });
    await ctx.db
      .insert(articles)
      .values({ type: "review", slug: "acme-review", title: "Acme", productId: product.id, status: "published" });
    await ctx.db.delete(categories).where(eq(categories.slug, "hosting"));
    const r = await evaluateReadiness(ctx.db, fullEnv, { fetch: site() });
    expect(item(r, "content.category.ai-tools")).toMatchObject({ status: "pass", evidence: { publishedReviews: 1 } });
    expect(item(r, "content.category.hosting").status).toBe("fail");
    expect(item(r, "content.published").detail).toContain("1 published review");
  });

  it("checks the Impressum and German articles once German is public", async () => {
    await setSetting(ctx.db, "i18n.policy", { enabledLocales: ["en", "de"], autoTranslate: ["de"] });
    let r = await evaluateReadiness(ctx.db, fullEnv, { fetch: site() });
    expect(item(r, "de.impressum").status).toBe("fail");
    expect(item(r, "de.articles").status).toBe("warn");
    r = await evaluateReadiness(ctx.db, fullEnv, { fetch: site({ impressumOk: true }) });
    expect(item(r, "de.impressum").status).toBe("pass");
    r = await evaluateReadiness(ctx.db, fullEnv, { fetch: site({ status: { "/impressum": 404 } }) });
    expect(item(r, "de.impressum").status).toBe("fail");
    r = await evaluateReadiness(ctx.db, fullEnv, { fetch: site({ down: true }) });
    expect(item(r, "de.impressum").status).toBe("warn");
  });

  it("fails the public-site group without a site URL and on non-200 pages", async () => {
    let r = await evaluateReadiness(ctx.db, {}, { fetch: site() });
    expect(item(r, "site.url").status).toBe("fail");
    r = await evaluateReadiness(ctx.db, fullEnv, { fetch: site({ status: { "/editorial-policy": 404 } }) });
    expect(item(r, "site.editorial_policy")).toMatchObject({ status: "fail" });
    expect(item(r, "site.health").status).toBe("pass");
  });
});
