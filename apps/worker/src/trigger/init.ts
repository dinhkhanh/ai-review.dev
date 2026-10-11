import { tasks } from "@trigger.dev/sdk";
import { initSentry, reportRunFailure } from "../sentry";

// Loaded automatically before any task runs (Trigger.dev `init.ts`). Every run that fails after
// its last retry is reported to Sentry with task, run and job ids (inert without SENTRY_DSN).
initSentry();

tasks.onFailure(async ({ ctx, payload, error }) => {
  await reportRunFailure(error, ctx, payload);
});
