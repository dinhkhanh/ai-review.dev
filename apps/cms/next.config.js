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

// The CMS loads no third-party scripts. Media (R2, or the web app's /media route) is shown in
// previews, and the email preview iframe (srcdoc) inherits this policy.
const csp = buildCsp({
  dev,
  connect: [sentryIngestOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN)],
  img: [originOf(process.env.NEXT_PUBLIC_MEDIA_URL), originOf(process.env.NEXT_PUBLIC_SITE_URL)],
  media: [originOf(process.env.NEXT_PUBLIC_MEDIA_URL), originOf(process.env.NEXT_PUBLIC_SITE_URL)],
  upgradeInsecureRequests: !dev && Boolean(originOf(process.env.NEXT_PUBLIC_CMS_URL)?.startsWith("https:")),
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
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // "same-origin" rather than "no-referrer": the latter makes browsers send `Origin: null` on
          // form posts, which fails the server-action and auth origin checks.
          ...baseSecurityHeaders({ csp, referrerPolicy: "same-origin" }),
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // Everything except hashed build assets is per-user: never store it in shared caches.
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "suzu-group",
  project: process.env.SENTRY_PROJECT ?? "ai-review-cms",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  errorHandler: (error) => console.warn(`Sentry source map upload failed: ${error.message}`),
});
