import { getDb } from "@repo/db";
import { Hono } from "hono";
import { createApp } from "./create-app";

/**
 * Vercel entrypoint. Vercel's Hono preset requires this file to import "hono" and default-export
 * the app. Local dev uses node-server.ts.
 */
const app = new Hono().route("/", createApp({ db: getDb }));

export default app;
