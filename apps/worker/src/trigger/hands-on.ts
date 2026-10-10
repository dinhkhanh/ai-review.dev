import { getDb } from "@repo/db";
import { createStepServices, JobPausedError, notifyJobFailed, runHandsOnJob } from "@repo/pipeline";
import { AbortTaskRunError, logger, queue, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { createPlaywrightDriver } from "../browser/playwright-driver";

/** One browser at a time: trials are slow, and a second one for the same vendor looks like abuse. */
const handsOnQueue = queue({ name: "hands-on", concurrencyLimit: 1 });

/**
 * Standalone hands-on trial (FR-RES-7), triggered from the CMS "Hands-on trials" page with the id
 * of a `hands_on` job. Not retried: a retry would sign up a second time with a new address.
 * Chromium needs more memory than the default machine.
 */
export const handsOnTrial = schemaTask({
  id: "hands-on-trial",
  schema: z.object({ jobId: z.uuid() }),
  queue: handsOnQueue,
  machine: "medium-1x",
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const db = getDb();
    try {
      return await runHandsOnJob(
        { ...createStepServices(db), makeBrowser: () => createPlaywrightDriver() },
        payload.jobId,
        { log: (message, data) => logger.info(message, data) },
      );
    } catch (error) {
      if (error instanceof JobPausedError) throw new AbortTaskRunError(error.message);
      throw error;
    }
  },
  onFailure: async ({ payload, error }) => {
    await notifyJobFailed(getDb(), payload.jobId, error);
  },
});
