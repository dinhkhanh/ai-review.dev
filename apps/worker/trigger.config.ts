import { additionalFiles, additionalPackages, aptGet, syncEnvVars } from "@trigger.dev/build/extensions/core";
import { playwright } from "@trigger.dev/build/extensions/playwright";
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
    external: [
      "sharp",
      "@resvg/resvg-js",
      "@fontsource/inter",
      // Remotion (FR-VID-3): native compositor + headless Chrome; never bundled by esbuild.
      "remotion",
      "@remotion/renderer",
      "@remotion/bundler",
      // Hands-on trials (FR-RES-7): driver + browser binaries come from the image, not the bundle.
      "playwright-core",
    ],
    extensions: [
      // @repo/graphics reads the font files via createRequire().resolve, which esbuild can't see,
      // so the external is never added to the image's package.json unless we install it explicitly.
      additionalPackages({ packages: ["@fontsource/inter@5.3.0"] }),
      // Video rendering (FR-VID-3, docs/deploy.md "Video"): the renderer is imported dynamically,
      // so install it explicitly; it brings its own ffmpeg (compositor) for linux-x64.
      additionalPackages({ packages: ["remotion@4.0.526", "@remotion/renderer@4.0.526"] }),
      // The Remotion bundle is prebuilt by `pnpm --filter @repo/video bundle` (run by `deploy`)
      // and lands at packages/video/build in the image, where @repo/video/render looks for it.
      additionalFiles({ files: ["../../packages/video/build/**"] }),
      // Hands-on trials (FR-RES-7): Chromium headless shell + its Debian libraries, pinned to the
      // playwright-core version in package.json. playwright-core itself is installed explicitly
      // because it is imported dynamically.
      playwright({ browsers: ["chromium"], headless: true, version: "1.64.0" }),
      additionalPackages({ packages: ["playwright-core@1.64.0"] }),
      // Shared libraries Chrome Headless Shell needs on Debian (downloaded on first render).
      aptGet({
        packages: [
          "libnss3",
          "libdbus-1-3",
          "libatk1.0-0",
          "libgbm-dev",
          "libasound2",
          "libxrandr2",
          "libxkbcommon-dev",
          "libxfixes3",
          "libxcomposite1",
          "libxdamage1",
          "libatk-bridge2.0-0",
          "libpango-1.0-0",
          "libcairo2",
          "libcups2",
          "fonts-noto-color-emoji",
        ],
      }),
      syncEnvVars(async (ctx) => (["prod", "production"].includes(ctx.environment) ? productionEnv() : [])),
    ],
  },
  // Research + writing can take a while; video renders (phase 2) longer still.
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 60_000, randomize: true },
  },
});
