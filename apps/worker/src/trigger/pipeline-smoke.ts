import { getDb } from "@repo/db";
import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { runPipelineSmoke } from "../run-smoke";

/** Trigger from the Trigger.dev dashboard to verify the deployed worker end to end. */
export const pipelineSmoke = schemaTask({
  id: "pipeline-smoke",
  schema: z.object({ message: z.string().min(1).max(200).default("ping"), useLlm: z.boolean().default(false) }),
  run: async (payload, { ctx }) => {
    const result = await runPipelineSmoke(getDb(), {
      ...payload,
      attempt: ctx.attempt.number,
      runId: ctx.run.id,
      log: (message, data) => logger.info(message, data),
    });
    return { jobId: result.jobId, output: result.output, totalCostUsd: result.job?.totalCostUsd };
  },
});
