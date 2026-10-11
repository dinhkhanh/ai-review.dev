import { serve } from "@hono/node-server";
import { getDb } from "@repo/db";
import { createApp } from "./create-app";
import { initSentry } from "./sentry";

initSentry();

const port = Number(process.env.PORT ?? 3002);
const app = createApp({ db: getDb });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port} (docs at /docs)`);
});
