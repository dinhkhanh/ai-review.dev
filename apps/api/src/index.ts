// Vercel entrypoint. Vercel's Hono preset detects this file by its import of "hono" and serves the
// default export. The import is type-only so the function has no runtime dependency to resolve:
// everything it runs lives in dist/app.js, prebuilt by `tsup` during `pnpm build`. Vercel's Node
// builder transpiles files one by one without bundling, so it cannot load the TypeScript-source
// workspace packages directly. Local dev uses node-server.ts; tests use create-app.ts.
import type { Hono } from "hono";
// @ts-ignore -- generated JavaScript bundle without type declarations
import bundled from "../dist/app.js";

const app: Hono = bundled;

export default app;
