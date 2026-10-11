import { serverSentryOptions } from "@repo/observability";
import * as Sentry from "@sentry/node";

/** Payload fields that identify our own records; reported as tags so a failure links to the CMS. */
const ID_FIELDS = ["jobId", "issueId", "videoId", "articleId", "productId", "trialId"] as const;

export interface FailureContext {
  task: { id: string };
  run: { id: string; tags?: string[]; isTest?: boolean };
  attempt?: { number?: number };
  environment?: { slug?: string; type?: string };
  machine?: { name?: string };
}

/** Tags for a failed run: task, run, attempt, environment and any record ids found in the payload. */
export function failureTags(ctx: FailureContext, payload: unknown): Record<string, string> {
  const tags: Record<string, string> = { task: ctx.task.id, run_id: ctx.run.id };
  if (ctx.attempt?.number !== undefined) tags.attempt = String(ctx.attempt.number);
  if (ctx.environment?.slug) tags.trigger_env = ctx.environment.slug;
  if (ctx.machine?.name) tags.machine = ctx.machine.name;
  if (payload && typeof payload === "object") {
    for (const field of ID_FIELDS) {
      const value = (payload as Record<string, unknown>)[field];
      if (typeof value === "string" && value.length <= 64) tags[field.replace(/Id$/, "_id")] = value;
    }
  }
  return tags;
}

let initialised = false;

/**
 * Error monitoring for the worker. Without SENTRY_DSN it does nothing. Trigger.dev runs its own
 * OpenTelemetry for run logs, so Sentry's OTEL setup and default (auto-patching) integrations are
 * skipped; we only capture failed runs explicitly.
 */
export function initSentry(env: Record<string, string | undefined> = process.env): boolean {
  if (initialised) return true;
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    ...serverSentryOptions(env),
    tracesSampleRate: 0,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    defaultIntegrations: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    initialScope: { tags: { service: "worker" } },
  });
  initialised = true;
  return true;
}

/** Reports a run that failed for good (all retries used) and flushes before the process moves on. */
export async function reportRunFailure(error: unknown, ctx: FailureContext, payload: unknown): Promise<void> {
  if (!initialised) return;
  if (ctx.run.isTest) return;
  Sentry.withScope((scope) => {
    scope.setTags(failureTags(ctx, payload));
    scope.setFingerprint(["{{ default }}", ctx.task.id]);
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
  await Sentry.flush(3000);
}
