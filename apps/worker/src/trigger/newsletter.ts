import { runDigestSchedule, sendDigestIssue } from "@repo/core";
import { getDb } from "@repo/db";
import { logger, queue, schedules, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

/** One digest send at a time; delivery claims make overlaps safe anyway, this just keeps it calm. */
const newsletterQueue = queue({ name: "newsletter", concurrencyLimit: 1 });

/**
 * Hourly (FR-WEB-9): at the "newsletter.digest" weekday/hour, builds last week's issue per public
 * locale and sends it (autoSend) or leaves a draft for the CMS. Also sends due scheduled issues and
 * resumes interrupted sends.
 */
export const newsletterDigest = schedules.task({
  id: "newsletter-digest",
  cron: "5 * * * *",
  queue: newsletterQueue,
  maxDuration: 3600,
  run: async () => {
    const result = await runDigestSchedule(getDb());
    if (result.built.length || result.sent.length) logger.info("newsletter digest", { ...result });
    return result;
  },
});

/** "Send now" from the CMS. Resumable: running it again continues where a crashed run stopped. */
export const newsletterSend = schemaTask({
  id: "newsletter-send",
  schema: z.object({ issueId: z.uuid() }),
  queue: newsletterQueue,
  maxDuration: 3600,
  retry: { maxAttempts: 2 },
  run: async ({ issueId }) => sendDigestIssue(getDb(), issueId),
});
