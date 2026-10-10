import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";
import { readFileSync } from "node:fs";

try {
  process.loadEnvFile("../../.env");
} catch {
  // Deployed builds get env from the Trigger.dev dashboard.
}

/** Variables the deployed worker needs; shared with scripts/prod.mjs (scripts/env-targets.json). */
// Only needed at deploy time on your machine; inside the deployed container the file is absent.
function loadTargets(): { trigger: string[]; public: string[] } {
  try {
    return JSON.parse(readFileSync(new URL("../../scripts/env-targets.json", import.meta.url), "utf8"));
  } catch {
    return { trigger: [], public: [] };
  }
}
const TARGETS = loadTargets();
const WORKER_ENV = TARGETS.trigger;
const PUBLIC_ENV = new Set(TARGETS.public);

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
