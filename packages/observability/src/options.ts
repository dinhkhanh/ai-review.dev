import { scrubBreadcrumb, scrubEvent } from "./scrub";

export interface SentryEnv {
  dsn?: string | null;
  environment?: string | null;
  tracesSampleRate?: string | number | null;
}

/** Options shared by every SDK init. Disabled (no network, no overhead) without a DSN. */
export function sentryOptions(env: SentryEnv) {
  const dsn = env.dsn?.trim() || undefined;
  const rate = Number(env.tracesSampleRate ?? 0);
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: env.environment?.trim() || "development",
    // Never attach IPs, cookies or request bodies automatically; scrubEvent() is the second line.
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

/** Server-side options from process.env (Node, edge, worker). */
export function serverSentryOptions(env: Record<string, string | undefined> = process.env) {
  return sentryOptions({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.VERCEL_ENV ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  });
}
