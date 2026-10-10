import { randomBytes } from "node:crypto";
import type { CostHandler, FirecrawlAdapter, Llm } from "@repo/ai";
import {
  createReviewJob,
  findOrCreateProduct,
  getHandsOnSession,
  getJob,
  listSources,
  putSecret,
  setHandsOnOptIn,
  setSetting,
  TEST_IDENTITY_SECRET,
} from "@repo/core";
import { costLedger, eq } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { createDbStorage } from "@repo/media";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StepServices } from "../step";
import { runHandsOnJob } from "./job";
import { currentUrl, fakeAgentLlm, fakeSite, refFor } from "./testing";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
const savedEnv = { ...process.env };
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => {
  process.env = savedEnv;
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
  process.env.VAULT_KEY = randomBytes(32).toString("base64");
  delete process.env.HANDS_ON_INBOX_DOMAIN;
});

let shade = 0;
const png = () =>
  sharp({ create: { width: 64, height: 40, channels: 3, background: { r: 40, g: 80, b: (shade += 40) % 255 } } })
    .png()
    .toBuffer();

const site = () =>
  fakeSite(
    {
      "https://acme.io/": {
        title: "Acme",
        text: "Acme boards",
        elements: [
          { id: "signup", role: "link", name: "Try it free", tag: "a", href: "https://acme.io/signup", to: "/signup" },
        ],
      },
      "https://acme.io/signup": {
        title: "Sign up",
        text: "Create account",
        elements: [
          { id: "email", role: "textbox", name: "Email", tag: "input", type: "email" },
          { id: "go", role: "button", name: "Sign up", tag: "button", to: "/app" },
        ],
      },
      "https://acme.io/app": { title: "App", text: "Welcome. Free plan: 3 boards.", elements: [] },
    },
    {},
  );

const policy = (op: string, prompt: string) => {
  if (op === "hands_on_findings") {
    return {
      signedUp: true,
      planObserved: "Free",
      onboardingSteps: ["Email only sign-up"],
      timeToValueMinutes: 1,
      observedFeatures: ["Boards"],
      limits: ["Free plan: 3 boards"],
      uiNotes: [],
      summary: "Sign-up needed only an email.",
    };
  }
  const url = currentUrl(prompt);
  const base = { thought: "", ref: "", value: "", observation: "" };
  if (url.endsWith("acme.io/")) return { ...base, action: "click", ref: refFor(prompt, /free/) };
  if (url.endsWith("/signup")) {
    if (!prompt.includes('type [e1] textbox "Email"'))
      return { ...base, action: "type", ref: "e1", value: "{{identity.email}}" };
    return { ...base, action: "click", ref: refFor(prompt, /Sign up/) };
  }
  if (!/\d+\. screenshot/.test(prompt))
    return { ...base, action: "screenshot", value: "Dashboard", observation: "Free plan: 3 boards" };
  return { ...base, action: "finish" };
};

function services(): StepServices {
  return {
    db: ctx.db,
    makeLlm: (onCost: CostHandler) => {
      const { llm } = fakeAgentLlm(policy, 0.02);
      return {
        ...llm,
        generateStructured: async (opts) => {
          const res = await llm.generateStructured(opts);
          await onCost({
            provider: "anthropic",
            model: opts.model,
            operation: opts.operation,
            units: 120,
            unitType: "tokens",
            costUsd: 0.02,
            meta: { inputTokens: 100, outputTokens: 20 },
          });
          return res;
        },
      } as Llm;
    },
    makeFirecrawl: () => ({}) as FirecrawlAdapter,
    storage: createDbStorage(ctx.db),
    makeBrowser: async () => {
      const s = site();
      return { ...s, screenshot: png };
    },
  };
}

async function setup(eligible: boolean) {
  const { product } = await findOrCreateProduct(ctx.db, { name: "Acme", websiteUrl: "https://acme.io" });
  if (eligible) {
    await setSetting(ctx.db, "pipeline.handsOnTrials", true);
    await setHandsOnOptIn(ctx.db, product.id, true);
    await putSecret(ctx.db, {
      name: TEST_IDENTITY_SECRET,
      kind: "test_identity",
      value: { name: "Ada Tester", email: "ada@example.org", password: "a-long-test-password" },
    });
  }
  const job = await createReviewJob(ctx.db, {
    preset: "hands_on",
    productId: product.id,
    input: { productId: product.id },
  });
  return { product, job };
}

describe("hands-on job (FR-RES-7)", () => {
  it("fails with the reasons when the product is not eligible", async () => {
    const { job } = await setup(false);
    await expect(runHandsOnJob(services(), job.id)).rejects.toThrow(/not opted in/);
    expect((await getJob(ctx.db, job.id))?.status).toBe("failed");
  });

  it("runs a session, stores screenshots, findings and a first-party source, and books the cost", async () => {
    const { product, job } = await setup(true);
    const result = await runHandsOnJob(services(), job.id);
    expect(result).toMatchObject({ status: "succeeded", stopReason: null });
    const loaded = await getJob(ctx.db, job.id);
    expect(loaded?.status).toBe("succeeded");
    expect(loaded?.steps.map((s) => s.name)).toEqual(["hands_on"]);

    const session = await getHandsOnSession(ctx.db, result.sessionId!);
    expect(session?.status).toBe("succeeded");
    expect(session?.screenshots.map((s) => s.alt)).toEqual(["Dashboard", "The product after sign-up"]);
    expect(session?.screenshots[0]).toMatchObject({ kind: "screenshot", origin: "captured", productId: product.id });
    expect(session?.findings).toMatchObject({ planObserved: "Free" });
    expect(Number(session?.costUsd)).toBeGreaterThan(0);

    const sources = await listSources(ctx.db, product.id, { withContent: true });
    expect(sources).toHaveLength(1);
    expect(sources[0]!.contentMd).toContain("Free plan: 3 boards");
    expect(sources[0]!.screenshotAssetId).toBe(session!.screenshotAssetIds[0]);

    const ledger = await ctx.db.select().from(costLedger).where(eq(costLedger.jobId, job.id));
    expect(ledger.map((l) => l.operation)).toContain("hands_on_findings");

    // A retry reuses the succeeded step instead of starting a second session.
    const again = await runHandsOnJob(services(), job.id);
    expect(again.sessionId).toBe(result.sessionId);
  });
});
