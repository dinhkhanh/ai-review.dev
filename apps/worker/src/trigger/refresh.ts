import { createReviewJob, deferRefresh, dueRefreshProducts, getSetting, DEFAULT_REFRESH_POLICY } from "@repo/core";
import { getDb } from "@repo/db";
import { logger, schedules } from "@trigger.dev/sdk";
import { reviewProduct } from "./review-product";

/**
 * Refresh scheduler (FR-MNT-1): daily, creates refresh jobs for products whose `next_refresh_at`
 * has passed (60 days by default, 14 for top-traffic pages), capped per run. Creating a job pushes
 * the date out a day as a lease; a finished refresh schedules the next one.
 */
export const refreshScheduler = schedules.task({
  id: "refresh-scheduler",
  cron: "40 4 * * *",
  run: async () => {
    const db = getDb();
    const policy = (await getSetting(db, "refresh.policy")) ?? DEFAULT_REFRESH_POLICY;
    if (!policy.enabled) return { created: 0, reason: "disabled in settings" };
    const due = await dueRefreshProducts(db, new Date(), policy.maxJobsPerRun);
    const jobs = [];
    for (const product of due) {
      const job = await createReviewJob(db, {
        preset: "refresh",
        productId: product.id,
        input: { productId: product.id, name: product.name, trigger: "schedule" },
      });
      await deferRefresh(db, product.id, 1);
      jobs.push(job);
    }
    if (jobs.length) {
      await reviewProduct.batchTrigger(
        jobs.map((job) => ({ payload: { jobId: job.id }, options: { tags: [`job_${job.id}`] } })),
      );
    }
    logger.info("refresh scheduler", { due: due.length, created: jobs.length });
    return { created: jobs.length, products: due.map((p) => p.name) };
  },
});
