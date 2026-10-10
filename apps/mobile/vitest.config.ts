import { defineConfig } from "vitest/config";

// Pure-logic tests only (src/lib); React Native components are verified by `bundle-check`.
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: { include: ["src/**/*.test.ts"] },
});
