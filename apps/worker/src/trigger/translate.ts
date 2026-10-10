import { createTranslationJob, getSetting, pendingAutoTranslations, undispatchedTranslationJobs } from "@repo/core";
import { eq, getDb, reviewJobs } from "@repo/db";
import { idempotencyKeys, logger, schedules } from "@trigger.dev/sdk";
import { reviewProduct } from "./review-product";

/** Auto-translations created per run, so enabling a locale back-fills the catalogue gradually. */
const MAX_NEW_PER_RUN = 5;

/**
 * Translation dispatch (phase 3 second locale), every 15 minutes:
 * 1. queues auto-translations (`i18n.policy.autoTranslate`) for published English articles whose
 *    translation is missing or stale — catches publishes made by the worker itself (auto-publish,
 *    scheduled publishing), whose publish hook can only create the job;
 * 2. hands queued translate jobs that have no run yet to `review-product`.
 */
export const translationDispatch = schedules.task({
  id: "translation-dispatch",
  cron: "*/15 * * * *",
  run: async () => {
    const db = getDb();
    const policy = await getSetting(db, "i18n.policy");
    let created = 0;
    if (policy?.autoTranslate.length) {
      for (const p of await pendingAutoTranslations(db, MAX_NEW_PER_RUN)) {
        const res = await createTranslationJob(db, { ...p, trigger: "auto_backfill" });
        if (res.created) created++;
      }
    }
    const jobs = await undispatchedTranslationJobs(db);
    for (const job of jobs) {
      const handle = await reviewProduct.trigger(
        { jobId: job.id },
        {
          tags: [`job_${job.id}`],
          idempotencyKey: await idempotencyKeys.create(`translate-job-${job.id}`, { scope: "global" }),
        },
      );
      await db.update(reviewJobs).set({ runId: handle.id }).where(eq(reviewJobs.id, job.id));
    }
    if (created || jobs.length) logger.info("translation dispatch", { created, dispatched: jobs.length });
    return { created, dispatched: jobs.length };
  },
});
