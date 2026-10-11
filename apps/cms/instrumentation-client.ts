import { sentryOptions } from "@repo/observability";
import * as Sentry from "@sentry/nextjs";

// Browser error monitoring for the CMS (errors only, no tracing or replay). Inert without a DSN.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    ...sentryOptions({ dsn, environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT, tracesSampleRate: 0 }),
    allowUrls: [window.location.origin],
    initialScope: { tags: { service: "cms" } },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
