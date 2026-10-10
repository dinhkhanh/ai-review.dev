import { checkPushReceipts, sendPendingPriceAlerts } from "@repo/core";
import { getDb } from "@repo/db";
import { logger, schemaTask, task } from "@trigger.dev/sdk";
import { z } from "zod";

/**
 * Expo delivery receipts for earlier push tickets (FR-API-4). Triggered with a 15-minute delay
 * (receipts are not ready sooner); devices Expo reports as unregistered stop receiving pushes.
 */
export const pushReceipts = schemaTask({
  id: "push-receipts",
  schema: z.object({
    tickets: z.array(z.object({ ticketId: z.string(), deviceId: z.uuid() })).max(10_000),
  }),
  run: async (payload) => {
    const result = await checkPushReceipts(getDb(), payload.tickets);
    logger.info("push receipts", result);
    return result;
  },
});

/** Price-change pushes to devices following a product (FR-API-4), every 15 minutes. */
export const priceAlertPush = task({
  id: "price-alert-push",
  // Started by a dispatcher in cron.ts.
  run: async () => {
    const result = await sendPendingPriceAlerts(getDb());
    if (result.changes) logger.info("price alert pushes", { ...result, tickets: result.tickets.length });
    if (result.tickets.length) await pushReceipts.trigger({ tickets: result.tickets }, { delay: "15m" });
    return { ...result, tickets: result.tickets.length };
  },
});
