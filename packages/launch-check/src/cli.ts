#!/usr/bin/env node
/**
 * Synthetic launch check (plan Phase 4). Read-only GETs with a bot/monitor User-Agent.
 *   node packages/launch-check/src/cli.ts --site <url> [--api <url>] [--cms <url>]
 *     [--mode quick|full] [--local] [--max-reviews N] [--indexnow-key KEY] [--json FILE] [--markdown FILE]
 * Exit code: 0 when nothing failed, 1 on any failed check, 2 on bad arguments.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatMarkdown, formatTable, summarize } from "./report.ts";
import { runChecks } from "./runner.ts";
import type { Options } from "./types.ts";

function usage(message: string): never {
  console.error(
    `${message}\nUsage: launch-check --site <url> [--api <url>] [--cms <url>] [--mode quick|full] [--local] [--max-reviews N] [--indexnow-key KEY] [--json FILE] [--markdown FILE]`,
  );
  process.exit(2);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      site: { type: "string" },
      api: { type: "string" },
      cms: { type: "string" },
      mode: { type: "string", default: "full" },
      local: { type: "boolean", default: false },
      "max-reviews": { type: "string", default: "5" },
      "indexnow-key": { type: "string" },
      json: { type: "string" },
      markdown: { type: "string" },
    },
  }));
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}
if (!values.site) usage("--site is required");
if (values.mode !== "quick" && values.mode !== "full") usage(`--mode must be quick or full, got ${values.mode}`);
const maxReviews = Number(values["max-reviews"]);
if (!Number.isInteger(maxReviews) || maxReviews < 1) usage("--max-reviews must be a positive integer");
for (const key of ["site", "api", "cms"] as const) {
  if (values[key] && !URL.canParse(values[key])) usage(`--${key} is not a URL: ${values[key]}`);
}

const opts: Options = {
  site: values.site,
  api: values.api,
  cms: values.cms,
  mode: values.mode,
  local: values.local,
  maxReviews,
  indexNowKey: values["indexnow-key"],
};

const startedAt = new Date().toISOString();
const results = await runChecks(opts);
console.log(formatTable(results));
if (values.json) {
  writeFileSync(
    values.json,
    `${JSON.stringify({ startedAt, options: { ...opts, indexNowKey: undefined }, summary: summarize(results), results }, null, 2)}\n`,
  );
}
if (values.markdown) writeFileSync(values.markdown, `${formatMarkdown(results, opts)}\n`);
process.exitCode = summarize(results).fail > 0 ? 1 : 0;
