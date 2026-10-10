import { publishDueArticles, publishEnvFromProcess, purgeOldClicks } from "@repo/core";
import { getDb } from "@repo/db";
import { logger, schedules } from "@trigger.dev/sdk";

/** Publishes articles scheduled in the CMS (FR-QA-2 `scheduled`), every 10 minutes. */
export const publishScheduled = schedules.task({
  id: "publish-scheduled",
  cron: "*/10 * * * *",
  run: async () => {
    const results = await publishDueArticles(getDb(), publishEnvFromProcess());
    if (results.length) logger.info("published scheduled articles", { results });
    return { published: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
  },
});

/** Daily housekeeping: raw click retention (NFR-8). */
export const dailyMaintenance = schedules.task({
  id: "daily-maintenance",
  cron: "17 3 * * *",
  run: async () => {
    const purgedClicks = await purgeOldClicks(getDb());
    logger.info("maintenance", { purgedClicks });
    return { purgedClicks };
  },
});
