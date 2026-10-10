import { createSearchConsoleClient } from "@repo/ai";
import { detectContentDecay, importSearchConsole, notify, SEARCH_CONSOLE_MAX_BACKFILL_DAYS } from "@repo/core";
import { getDb } from "@repo/db";
import { logger, schedules, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

/** Import, then decay detection; a failed import still re-evaluates decay on the data we have. */
async function importAndDetect(days?: number) {
  const db = getDb();
  const client = createSearchConsoleClient();
  let imported: Awaited<ReturnType<typeof importSearchConsole>> | { skipped: string };
  if (!client) {
    imported = { skipped: "GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY or GSC_SITE_URL not set" };
    logger.info("search console import skipped", imported);
  } else {
    try {
      imported = await importSearchConsole(db, client, { days });
      logger.info("search console import", { ...imported });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("search console import failed", { message });
      await notify(db, {
        event: "searchConsole.failed",
        title: "Search Console import failed",
        body: message.slice(0, 1000),
        href: "/decay",
        dedupeKey: `searchConsole.failed:${new Date().toISOString().slice(0, 10)}`,
      });
      throw error;
    }
  }
  const decay = await detectContentDecay(db);
  logger.info("content decay", { ...decay });
  return { imported, decay };
}

/**
 * Daily Search Console import + content-decay detection (FR-MNT-3). Runs before the refresh
 * scheduler (04:40) so refreshes pulled forward by decay are picked up the same morning.
 */
export const searchConsoleDaily = schedules.task({
  id: "search-console-import",
  cron: "55 3 * * *",
  run: async () => importAndDetect(),
});

/** "Import now" / backfill from the CMS (up to Search Console's 16 months). */
export const searchConsoleNow = schemaTask({
  id: "search-console-import-now",
  schema: z.object({ days: z.number().int().min(1).max(SEARCH_CONSOLE_MAX_BACKFILL_DAYS).optional() }),
  run: async (payload) => importAndDetect(payload.days),
});
