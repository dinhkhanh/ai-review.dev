import { backfillSearchText } from "@repo/core";
import { getDb } from "@repo/db";
import { logger, schedules, task } from "@trigger.dev/sdk";

/**
 * Site search index upkeep (FR-WEB-7). Publishing refreshes `search_text`; this daily pass fills
 * articles published before search existed or edited outside the publish flow.
 */
export const searchBackfill = schedules.task({
  id: "search-backfill",
  cron: "41 3 * * *",
  run: async () => {
    const updated = await backfillSearchText(getDb());
    if (updated) logger.info("search text backfilled", { updated });
    return { updated };
  },
});

/** On-demand version of the backfill (e.g. after a bulk import). */
export const rebuildSearchText = task({
  id: "rebuild-search-text",
  run: async (payload: { limit?: number } = {}) => ({
    updated: await backfillSearchText(getDb(), payload.limit ?? 5000),
  }),
});
