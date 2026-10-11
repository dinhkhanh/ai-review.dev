import { serverSentryOptions } from "@repo/observability";
import * as Sentry from "@sentry/node";

/**
 * Error monitoring for the API (errors only). Without SENTRY_DSN nothing is initialised and
 * captureException() is a no-op. OpenTelemetry auto-instrumentation is skipped: it cannot patch a
 * bundled function and we do not trace here.
 */
export function initSentry() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    ...serverSentryOptions(),
    tracesSampleRate: 0,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    initialScope: { tags: { service: "api" } },
  });
}

/** Reports an unexpected error and waits briefly so serverless functions do not freeze first. */
export async function reportError(error: unknown, context: { method: string; path: string }) {
  if (!Sentry.getClient()) return;
  Sentry.withScope((scope) => {
    scope.setTag("route", `${context.method} ${context.path}`);
    Sentry.captureException(error);
  });
  await Sentry.flush(2000);
}
