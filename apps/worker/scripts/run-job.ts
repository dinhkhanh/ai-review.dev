import { claimNextQueuedJob, createReviewJob, publishDueArticles, publishEnvFromProcess } from "@repo/core";
import { getDb } from "@repo/db";
import { createStepServices, REVIEW_STEPS, runReviewJob, type ReviewStep } from "@repo/pipeline";

/**
 * Local pipeline runner (no Trigger.dev needed):
 *   pnpm --filter worker run-job <jobId> [--from <step>] [--only <step>]
 *   pnpm --filter worker run-job --url https://example.com   # create a quick-review job and run it
 *   pnpm --filter worker run-job --refresh <productId>        # create a refresh job and run it
 *   pnpm --filter worker runner          # poll queued jobs and scheduled publishes until Ctrl+C
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const asStep = (s: string | undefined) => {
  if (!s) return undefined;
  if (!(REVIEW_STEPS as readonly string[]).includes(s))
    throw new Error(`Unknown step ${s}. Steps: ${REVIEW_STEPS.join(", ")}`);
  return s as ReviewStep;
};
const log = (message: string, data?: Record<string, unknown>) =>
  console.log(
    `${new Date().toISOString().slice(11, 19)} ${message}${data ? ` ${JSON.stringify(data).slice(0, 300)}` : ""}`,
  );

const db = getDb();
const services = createStepServices(db);

if (args[0] === "--poll") {
  log(`runner polling for queued jobs (storage: ${services.storage?.kind})`);
  for (;;) {
    const jobId = await claimNextQueuedJob(db);
    if (jobId) {
      log(`claimed job ${jobId}`);
      await runReviewJob(services, jobId, { log }).then(
        (r) => log(`job ${jobId} done`, { articleId: r.articleId, hardGatesPassed: r.qa.hardGatesPassed }),
        (e) => log(`job ${jobId} failed: ${e instanceof Error ? e.message : String(e)}`),
      );
      continue;
    }
    const published = await publishDueArticles(db, publishEnvFromProcess());
    if (published.length) log("published scheduled articles", { published });
    await new Promise((r) => setTimeout(r, 5000));
  }
} else {
  const url = flag("--url");
  const refresh = flag("--refresh");
  const jobId = url
    ? (await createReviewJob(db, { preset: "quick_review", input: { url } })).id
    : refresh
      ? (await createReviewJob(db, { preset: "refresh", productId: refresh, input: { productId: refresh } })).id
      : args.find((a) => /^[0-9a-f-]{36}$/i.test(a));
  if (url || refresh) log(`created job ${jobId}`);
  if (!jobId) {
    console.error("Usage: run-job <jobId> [--from <step>] [--only <step>]  |  run-job --url <url>  |  run-job --poll");
    process.exit(1);
  }
  const result = await runReviewJob(services, jobId, {
    fromStep: asStep(flag("--from")),
    onlyStep: asStep(flag("--only")),
    log,
  });
  log("done", result as unknown as Record<string, unknown>);
  process.exit(0);
}
