import { defineConfig } from "@trigger.dev/sdk";

try {
  process.loadEnvFile("../../.env");
} catch {
  // Deployed builds get env from the Trigger.dev dashboard.
}

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_unset",
  dirs: ["./src/trigger"],
  runtime: "node",
  // Research + writing can take a while; video renders (phase 2) longer still.
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 60_000, randomize: true },
  },
});
