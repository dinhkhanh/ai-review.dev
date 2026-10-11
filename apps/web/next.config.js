import { baseSecurityHeaders, buildCsp, originOf, sentryIngestOrigin } from "@repo/observability/headers";
import { withSentryConfig } from "@sentry/nextjs/config";
import { fileURLToPath } from "node:url";

// All apps share the repo-root .env in development (see .env.example). Variables already set in
// the environment (Vercel, CI) win. Loaded here so Next's build workers inherit them.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No root .env: rely on the platform environment.
}

const dev = process.env.NODE_ENV === "development";

// Same-origin route that forwards browser error events to Sentry (ad-blockers drop direct ingest
// requests). Under /api/ so proxy.ts does not locale-rewrite it.
const SENTRY_TUNNEL = "/api/diag";

/**
 * CSP for the public site (static/ISR, so no nonces; see @repo/observability/headers). Third
 * parties actually loaded: Cloudflare Turnstile (forms), Plausible (analytics), YouTube nocookie
 * embeds and thumbnails (video reviews), R2 media, and Sentry (normally via the tunnel).
 */
const csp = buildCsp({
  dev,
  script: ["https://challenges.cloudflare.com", "https://plausible.io"],
  connect: [
    "https://plausible.io",
    "https://challenges.cloudflare.com",
    sentryIngestOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN),
  ],
  img: [originOf(process.env.NEXT_PUBLIC_MEDIA_URL), originOf(process.env.NEXT_PUBLIC_SITE_URL), "https://i.ytimg.com"],
  media: [originOf(process.env.NEXT_PUBLIC_MEDIA_URL)],
  frame: ["https://challenges.cloudflare.com", "https://www.youtube-nocookie.com"],
  // Only on https deployments: local and CI production builds are served over http://localhost.
  upgradeInsecureRequests: !dev && Boolean(originOf(process.env.NEXT_PUBLIC_SITE_URL)?.startsWith("https:")),
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  typescript: {
    // Type-checking runs in the `check-types` task (tsc 7); skip the duplicate pass in `next build`.
    ignoreBuildErrors: true,
  },
  env: {
    // Browser events carry the deployment environment (the browser cannot read SENTRY_ENVIRONMENT).
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  },
  async rewrites() {
    // IndexNow key file must live at the site root (FR-WEB-4).
    return [{ source: "/:key([a-f0-9]{32}).txt", destination: "/api/indexnow-key/:key" }];
  },
  async headers() {
    return [{ source: "/:path*", headers: baseSecurityHeaders({ csp }) }];
  },
};

// Sentry wraps the config for source maps and the tunnel. It is harmless without Sentry variables:
// no DSN means the SDK never initialises, and source maps upload only when SENTRY_AUTH_TOKEN is set.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "suzu-group",
  project: process.env.SENTRY_PROJECT ?? "ai-review-web",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  tunnelRoute: SENTRY_TUNNEL,
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // A Sentry outage or a bad token must never fail a deploy.
  errorHandler: (error) => console.warn(`Sentry source map upload failed: ${error.message}`),
});
