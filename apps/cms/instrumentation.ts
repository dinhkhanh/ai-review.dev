import * as Sentry from "@sentry/nextjs";
import { serverSentryOptions } from "@repo/observability";

/** Server and edge error monitoring. Without SENTRY_DSN nothing is initialised. */
export function register() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({ ...serverSentryOptions(), initialScope: { tags: { service: "cms" } } });
}

// Errors thrown while rendering or in route handlers (no-op when Sentry is not initialised).
export const onRequestError = Sentry.captureRequestError;
