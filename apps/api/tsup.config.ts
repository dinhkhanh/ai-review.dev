import { defineConfig } from "tsup";

// ESM bundles that inline CommonJS dependencies need a real `require` for Node built-ins.
const requireShim = `import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);`;

export default defineConfig([
  {
    // Standalone Node server (`pnpm start`). Internal packages export TypeScript source, so bundle them.
    entry: ["src/node-server.ts"],
    format: ["esm"],
    target: "node24",
    platform: "node",
    outDir: "dist",
    clean: true,
    sourcemap: true,
    noExternal: [/^@repo\//],
  },
  {
    // Vercel function bundle imported by src/index.ts: everything inlined so file tracing has
    // nothing left to resolve from pnpm's isolated node_modules.
    entry: { app: "src/vercel-app.ts" },
    format: ["esm"],
    target: "node24",
    platform: "node",
    outDir: "dist",
    sourcemap: true,
    noExternal: [/.*/],
    banner: { js: requireShim },
  },
]);
