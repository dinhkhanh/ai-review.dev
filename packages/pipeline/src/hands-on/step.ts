import {
  createHandsOnSession,
  finishHandsOnSession,
  getHandsOnPolicy,
  getProduct,
  getSecret,
  handsOnEligibility,
  productCredentialName,
  productCredentialSchema,
  recordHandsOnEvidence,
  recordHandsOnProgress,
  startHandsOnSession,
  TEST_IDENTITY_SECRET,
  testIdentitySchema,
} from "@repo/core";
import { saveImageAsset } from "@repo/media";
import { z } from "zod";
import { defineStep } from "../step";
import { runHandsOnAgent } from "./agent";
import { createResendInbox } from "./inbox";
import { buildSessionSecrets } from "./secrets";

/**
 * hands_on (FR-RES-7): one browser-agent trial for an opted-in product. In a full review it is
 * optional and skipped when the product is not eligible; the standalone "hands_on" preset sets
 * `required` so an ineligible product fails the job with the reasons. The notes become a
 * first-party source before chunk_embed, so extraction and the writer can cite them.
 */
export const handsOnStep = defineStep({
  name: "hands_on",
  input: z.object({ productId: z.uuid(), required: z.boolean().default(false) }),
  output: z.object({
    sessionId: z.uuid().nullable(),
    status: z.enum(["succeeded", "blocked", "skipped"]),
    stopReason: z.string().nullable(),
    sourceId: z.uuid().nullable(),
    screenshots: z.number(),
    costUsd: z.number(),
    skipped: z.string().nullable(),
  }),
  async run(ctx, input) {
    const skip = (why: string) => {
      if (input.required) throw new Error(`Hands-on trial not possible: ${why}`);
      ctx.log("hands-on skipped", { why });
      return {
        output: {
          sessionId: null,
          status: "skipped" as const,
          stopReason: null,
          sourceId: null,
          screenshots: 0,
          costUsd: 0,
          skipped: why,
        },
      };
    };
    // In a review, a crashed earlier attempt (e.g. the browser ran out of memory) is not retried:
    // the review goes on without hands-on notes rather than looping on the crash.
    if (!input.required && ctx.attempt > 1) return skip("an earlier attempt did not finish");
    const eligibility = await handsOnEligibility(ctx.db, input.productId);
    if (!eligibility.eligible) return skip(eligibility.reasons.join("; "));
    if (!ctx.browser) return skip("no browser in this environment (runs only in the worker)");
    const product = await getProduct(ctx.db, input.productId);
    if (!product) throw new Error(`Product ${input.productId} not found`);

    const identity = testIdentitySchema.parse(await getSecret(ctx.db, TEST_IDENTITY_SECRET));
    const loginRaw = await getSecret(ctx.db, productCredentialName(product.id));
    const login = loginRaw ? productCredentialSchema.parse(loginRaw) : null;
    const inboxDomain = process.env.HANDS_ON_INBOX_DOMAIN?.trim() || null;
    const resendKey = process.env.RESEND_API_KEY?.trim() || null;
    const secrets = buildSessionSecrets({ identity, productSlug: product.slug, inboxDomain, login });
    const inbox = inboxDomain && resendKey ? createResendInbox({ apiKey: resendKey, fetch: ctx.fetch }) : null;
    for (const warning of eligibility.warnings) ctx.log(warning);

    const [policy, prompt] = await Promise.all([getHandsOnPolicy(ctx.db), ctx.prompt("hands_on")]);
    const session = await createHandsOnSession(ctx.db, { productId: product.id, jobId: ctx.jobId });
    await startHandsOnSession(ctx.db, session.id);
    const storage = ctx.storage;
    let shot = 0;
    const driver = await ctx.browser();
    let result: Awaited<ReturnType<typeof runHandsOnAgent>>;
    try {
      result = await runHandsOnAgent({
        llm: ctx.llm,
        prompt,
        driver,
        product: { name: product.name, websiteUrl: product.websiteUrl },
        secrets,
        inbox,
        policy,
        log: ctx.log,
        onProgress: (p) => recordHandsOnProgress(ctx.db, session.id, p),
        onScreenshot: storage
          ? async ({ bytes, caption }) => {
              const asset = await saveImageAsset(ctx.db, storage, {
                bytes,
                kind: "screenshot",
                origin: "captured",
                prefix: `products/${product.id}/hands-on/${session.id}`,
                role: `hands_on:${++shot}`,
                alt: caption,
                productId: product.id,
                capturedAt: new Date(),
                licenseNote: "Screenshot of the product's app taken during a hands-on trial by ai-review.dev.",
              });
              return asset.id;
            }
          : undefined,
      });
    } catch (error) {
      await finishHandsOnSession(ctx.db, session.id, {
        status: "failed",
        stopReason: String(error instanceof Error ? error.message : error).slice(0, 300),
        actions: [],
        screenshotAssetIds: [],
        costUsd: 0,
      }).catch(() => {});
      throw error;
    } finally {
      await driver.close().catch(() => {});
    }

    const screenshotAssetIds = result.screenshots.map((s) => s.assetId);
    await finishHandsOnSession(ctx.db, session.id, {
      status: result.status,
      stopReason: result.stopReason ?? null,
      actions: result.actions,
      findings: result.findings,
      screenshotAssetIds,
      costUsd: result.costUsd,
    });
    const source = result.findings
      ? await recordHandsOnEvidence(ctx.db, {
          productId: product.id,
          sessionId: session.id,
          jobId: ctx.jobId,
          findings: result.findings,
          status: result.status,
          stopReason: result.stopReason,
          screenshotAssetIds,
          screenshotCaptions: result.screenshots.map((s) => s.caption),
        })
      : null;
    ctx.log("hands-on finished", {
      status: result.status,
      stopReason: result.stopReason,
      steps: result.steps,
      costUsd: Number(result.costUsd.toFixed(4)),
    });
    return {
      output: {
        sessionId: session.id,
        status: result.status,
        stopReason: result.stopReason,
        sourceId: source?.id ?? null,
        screenshots: screenshotAssetIds.length,
        costUsd: result.costUsd,
        skipped: null,
      },
      model: prompt.model,
      effort: prompt.effort,
      promptVersion: prompt.version,
    };
  },
});
