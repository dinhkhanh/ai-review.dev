import { getDb } from "@repo/db";
import { runPipelineSmoke } from "../src/run-smoke";

/** Local CLI: `pnpm --filter worker smoke [--llm]`. Uses the dev database and real API keys. */
const useLlm = process.argv.includes("--llm");
if (useLlm && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set in .env");
  process.exit(1);
}
const result = await runPipelineSmoke(getDb(), { message: "ping", useLlm, log: (m) => console.log(`  ${m}`) });
console.log(
  JSON.stringify(
    {
      jobId: result.jobId,
      output: result.output,
      totalCostUsd: result.job?.totalCostUsd,
      steps: result.job?.steps.map((s) => ({ name: s.name, status: s.status, model: s.model })),
    },
    null,
    2,
  ),
);
process.exit(0);
