import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile("../../.env");
} catch {
  // CI provides env directly.
}

export default defineConfig({
  test: {
    // DB-backed test files share one database; run them serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
