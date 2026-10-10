import { defineConfig } from "tsup";

// Internal packages export TypeScript source (just-in-time packages), so bundle them in.
export default defineConfig({
  entry: ["src/node-server.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@repo\//],
});
