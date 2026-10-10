import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/links.ts", "src/resolve.ts", "src/click.ts"],
      // NFR-12: the link builder and redirect resolver are fully branch-covered.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
