import { sentryOptions } from "@repo/observability";
import * as Sentry from "@sentry/react-native";

/**
 * Crash and error reporting (errors only: no tracing, no session replay). Inert without
 * EXPO_PUBLIC_SENTRY_DSN. Events go through the shared PII scrubber; the device id and its secret
 * never leave the device in a report.
 */
export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    ...sentryOptions({
      dsn,
      environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || (__DEV__ ? "development" : "production"),
      tracesSampleRate: 0,
    }),
    attachScreenshot: false,
    attachViewHierarchy: false,
  });
}

export const wrapRoot = Sentry.wrap;
