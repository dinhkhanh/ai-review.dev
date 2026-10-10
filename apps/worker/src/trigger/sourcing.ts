import { getDb } from "@repo/db";
import { createStepServices, runProductSourcing } from "@repo/pipeline";
import { logger, schedules, task } from "@trigger.dev/sdk";

/** Daily product sourcing (FR-INT-7); does nothing while "sourcing.policy" is disabled. */
export const productSourcing = schedules.task({
  id: "product-sourcing",
  cron: "40 6 * * *",
  maxDuration: 900,
  run: async () =>
    runProductSourcing(createStepServices(getDb()), { log: (message, data) => logger.info(message, data) }),
});

/** "Run sourcing now" from the CMS queue: runs even when the daily schedule is disabled. */
export const productSourcingNow = task({
  id: "product-sourcing-now",
  maxDuration: 900,
  run: async () =>
    runProductSourcing(createStepServices(getDb()), {
      force: true,
      log: (message, data) => logger.info(message, data),
    }),
});
