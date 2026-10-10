import { logger, schedules } from "@trigger.dev/sdk";
import { affiliateReminders, importPageViews, linkHealth, syncConversionsDaily } from "./affiliate-ops";
import { priceAlertPush } from "./mobile";
import { newsletterDigest } from "./newsletter";
import { refreshScheduler } from "./refresh";
import { dailyMaintenance } from "./scheduled";
import { searchConsoleDaily } from "./search-console";
import { searchBackfill } from "./site-ops";
import { productSourcing } from "./sourcing";
import { videoAutogen } from "./video";
import { translationDispatch } from "./translate";

/**
 * Cron dispatchers. The Trigger.dev plan allows 10 schedules per project, so recurring jobs are
 * plain tasks started from these three schedules (plus `publish-scheduled`), grouped by cadence.
 */

/** Daily, 02:50 UTC. Traffic imports finish first because the refresh scheduler ranks by them. */
export const cronDaily = schedules.task({
  id: "cron-daily",
  cron: "50 2 * * *",
  run: async () => {
    for (const importer of [importPageViews, searchConsoleDaily]) {
      const result = await importer.triggerAndWait();
      if (!result.ok) logger.warn("daily import failed; continuing", { task: importer.id, error: result.error });
    }
    const started = [];
    for (const job of [
      refreshScheduler,
      linkHealth,
      syncConversionsDaily,
      dailyMaintenance,
      searchBackfill,
      productSourcing,
      affiliateReminders,
    ]) {
      started.push({ task: job.id, runId: (await job.trigger()).id });
    }
    return { started };
  },
});

/** Hourly: the digest checks its own weekday/hour setting; video autogen picks up new articles. */
export const cronHourly = schedules.task({
  id: "cron-hourly",
  cron: "5 * * * *",
  run: async () => ({
    started: [(await newsletterDigest.trigger()).id, (await videoAutogen.trigger()).id],
  }),
});

/** Every 15 minutes: queued translations and pending price-alert pushes. */
export const cronQuarterHourly = schedules.task({
  id: "cron-quarter-hourly",
  cron: "*/15 * * * *",
  run: async () => ({
    started: [(await translationDispatch.trigger()).id, (await priceAlertPush.trigger()).id],
  }),
});
