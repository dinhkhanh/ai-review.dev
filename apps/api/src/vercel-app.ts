import { getDb } from "@repo/db";
import { createApp } from "./create-app";
import { initSentry } from "./sentry";

initSentry();

/** Bundled by tsup into dist/app.js (workspace packages and dependencies inlined) for Vercel. */
export default createApp({ db: getDb });
