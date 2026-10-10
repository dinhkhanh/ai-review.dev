import { getDb } from "@repo/db";
import { createApp } from "./create-app";

/** Vercel entrypoint: Vercel's Hono preset serves the default-exported app. Local dev uses node-server.ts. */
export default createApp({ db: getDb });
