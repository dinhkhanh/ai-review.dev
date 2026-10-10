import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";
import { readFileSync } from "node:fs";

try {
  process.loadEnvFile("../../.env");
} catch {
  // Deployed builds get env from the Trigger.dev dashboard.
}

/** Variables the deployed worker needs (docs/deploy.md). Secrets are stored as Trigger.dev secrets. */
const WORKER_ENV = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "FIRECRAWL_API_KEY",
  "VOYAGE_API_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "NEXT_PUBLIC_MEDIA_URL",
  "NEXT_PUBLIC_SITE_URL",
  "REVALIDATE_SECRET",
  "SENTRY_DSN",
];
const PUBLIC_ENV = new Set(["R2_BUCKET", "NEXT_PUBLIC_MEDIA_URL", "NEXT_PUBLIC_SITE_URL"]);

/** Reads .env.production.local (gitignored) when deploying to production; nothing otherwise. */
function productionEnv(): Array<{ name: string; value: string; isSecret: boolean }> {
  let text: string;
  try {
    text = readFileSync(new URL("../../.env.production.local", import.meta.url), "utf8");
  } catch {
    return [];
  }
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m?.[2]?.trim()) values.set(m[1]!, m[2].trim());
  }
  return WORKER_ENV.flatMap((name) => {
    const value = values.get(name);
    return value ? [{ name, value, isSecret: !PUBLIC_ENV.has(name) }] : [];
  });
}

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_unset",
  dirs: ["./src/trigger"],
  runtime: "node",
  build: {
    // Native and file-reading packages stay out of the bundle (installed in the deploy image).
    external: ["sharp", "@resvg/resvg-js", "@fontsource/inter"],
    extensions: [syncEnvVars(async (ctx) => (["prod", "production"].includes(ctx.environment) ? productionEnv() : []))],
  },
  // Research + writing can take a while; video renders (phase 2) longer still.
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 60_000, randomize: true },
  },
});
