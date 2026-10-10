import {
  CONVERSION_NETWORKS,
  configuredConversionNetworks,
  importPlausiblePageViews,
  remindStaleApplications,
  runLinkHealthChecks,
  syncNetworkConversions,
} from "@repo/core";
import { getDb } from "@repo/db";
import { logger, schemaTask, task } from "@trigger.dev/sdk";
import { z } from "zod";

const DAY = 86_400_000;

/** Daily affiliate link health check (FR-AFF-10): broken links are paused and the admin notified. */
export const linkHealth = task({
  id: "link-health",
  // Started by a dispatcher in cron.ts.
  run: async () => {
    const result = await runLinkHealthChecks(getDb());
    logger.info("link health", result);
    return result;
  },
});

/** "Check now" from the CMS: re-checks specific links (any status) or all active/pending ones. */
export const linkHealthNow = schemaTask({
  id: "link-health-now",
  schema: z.object({ linkIds: z.array(z.uuid()).max(500).optional() }),
  run: async (payload) => runLinkHealthChecks(getDb(), { linkIds: payload.linkIds }),
});

/** Daily program status reminders for applications that have been pending for two weeks (FR-CMS-8). */
export const affiliateReminders = task({
  id: "affiliate-reminders",
  // Started by a dispatcher in cron.ts.
  run: async () => remindStaleApplications(getDb()),
});

async function syncConversions(days: number, networks?: Array<(typeof CONVERSION_NETWORKS)[number]>) {
  const configured = configuredConversionNetworks();
  const selected = (networks ?? configured).filter((n) => configured.includes(n));
  if (selected.length === 0) return { skipped: "no network credentials configured", results: [] };
  const now = new Date();
  const results = await syncNetworkConversions(getDb(), {
    from: new Date(now.getTime() - days * DAY),
    to: now,
    networks: selected,
  });
  logger.info("conversion sync", { results });
  return { results };
}

/** Daily conversion import from network reporting APIs, last 30 days (FR-AFF-11). */
export const syncConversionsDaily = task({
  id: "sync-conversions",
  // Started by a dispatcher in cron.ts.
  run: async () => syncConversions(30),
});

/** "Sync now" from the CMS. */
export const syncConversionsNow = schemaTask({
  id: "sync-conversions-now",
  schema: z.object({
    networks: z.array(z.enum(CONVERSION_NETWORKS)).optional(),
    days: z.number().int().min(1).max(90).default(30),
  }),
  run: async (payload) => syncConversions(payload.days, payload.networks),
});

/** Daily Plausible page-view import for the last 3 days (FR-ANL-2, FR-MNT-1 top-traffic cadence). */
export const importPageViews = task({
  id: "import-page-views",
  // Started by a dispatcher in cron.ts.
  run: async () => {
    const apiKey = process.env.PLAUSIBLE_API_KEY;
    const siteId = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
    if (!apiKey || !siteId) return { skipped: "PLAUSIBLE_API_KEY or NEXT_PUBLIC_PLAUSIBLE_DOMAIN not set" };
    const now = new Date();
    const result = await importPlausiblePageViews(getDb(), {
      apiKey,
      siteId,
      from: new Date(now.getTime() - 3 * DAY),
      to: now,
    });
    logger.info("page views", result);
    return result;
  },
});
