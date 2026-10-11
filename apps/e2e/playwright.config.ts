import { defineConfig, devices } from "@playwright/test";
import { urls } from "./src/fixtures";

/**
 * Browser e2e against production builds (`next start`, `node dist/node-server.js`) seeded by
 * `src/seed.ts`. Build web, CMS and API first with the same DATABASE_URL and NEXT_PUBLIC_* URLs
 * (see .github/workflows/ci.yml, job "e2e"). Locally an already-running stack is reused.
 */
const CI = !!process.env.CI;
/** CI starts the servers once (shared with Lighthouse and the launch check) and sets this. */
const reuse = !CI || process.env.E2E_REUSE_SERVERS === "1";
const port = (u: string) => new URL(u).port || "80";

/** Server env: the e2e database and fixed secrets; every external integration switched off. */
const serverEnv: Record<string, string> = {
  ...(process.env as Record<string, string>),
  NODE_ENV: "production",
  REVALIDATE_SECRET: process.env.REVALIDATE_SECRET ?? "e2e-revalidate-secret",
  // Empty values win over the repo-root .env (platform env is never overwritten by it).
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  TRIGGER_SECRET_KEY: "",
  RESEND_API_KEY: "",
  TURNSTILE_SECRET_KEY: "",
  ANTHROPIC_API_KEY: "",
  FIRECRAWL_API_KEY: "",
  VOYAGE_API_KEY: "",
  NOTIFY_WEBHOOK_URL: "",
  TELEGRAM_BOT_TOKEN: "",
  SENTRY_DSN: "",
  NEXT_PUBLIC_SENTRY_DSN: "",
};

const server = (filter: string, url: string, health: string) => ({
  command: `pnpm --filter ${filter} start`,
  url: `${url}${health}`,
  env: { ...serverEnv, PORT: port(url) },
  reuseExistingServer: reuse,
  timeout: 120_000,
  stdout: "ignore" as const,
  stderr: "pipe" as const,
});

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./src/global-setup.ts",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: urls.site,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "public", testMatch: /public|a11y|api/, use: { ...devices["Desktop Chrome"] } },
    { name: "public-mobile", testMatch: /public\.spec/, use: { ...devices["Pixel 7"] } },
    // The CMS flow publishes the queued review; it runs after the public specs read the seed.
    { name: "cms", testMatch: /cms/, dependencies: ["public", "public-mobile"], use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    server("web", urls.site, "/api/health"),
    server("cms", urls.cms, "/login"),
    server("api", urls.api, "/v1/health"),
  ],
});
