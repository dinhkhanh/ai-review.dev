import { sentryOptions } from "@repo/observability";

type SentrySdk = typeof import("@sentry/nextjs");

// Browser error monitoring. The SDK is loaded as a separate chunk after hydration and only when a
// DSN is configured, so it never costs the critical path (FR-WEB-3). Errors only: no tracing or
// session replay, and events go through the same-origin tunnel (`tunnelRoute` in next.config.js).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
let sdk: SentrySdk | null = null;
if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      ...sentryOptions({ dsn, environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT, tracesSampleRate: 0 }),
      // Browser extensions and third-party scripts are not ours to fix.
      allowUrls: [window.location.origin],
      initialScope: { tags: { service: "web" } },
      // Only real errors go through the tunnel (each request is a function invocation): no
      // release-health sessions or client reports on page views.
      integrations: (defaults) => defaults.filter((i) => i.name !== "BrowserSession"),
      sendClientReports: false,
    });
    sdk = Sentry;
  });
}

/** Navigation breadcrumbs once the SDK has loaded (Next.js calls this on client navigations). */
export function onRouterTransitionStart(...args: Parameters<SentrySdk["captureRouterTransitionStart"]>) {
  sdk?.captureRouterTransitionStart(...args);
}
