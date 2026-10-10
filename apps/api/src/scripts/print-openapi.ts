import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDb } from "@repo/db";
import { createApp } from "../create-app";

/**
 * Writes the OpenAPI document to packages/contracts/openapi.json (FR-API-1). The typed client is
 * then generated from it: `pnpm --filter api generate-client`. A contract test fails on drift.
 */
export async function openApiDocument(): Promise<unknown> {
  const res = await createApp({ db: getDb }).request("/openapi.json");
  return res.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = fileURLToPath(new URL("../../../../packages/contracts/openapi.json", import.meta.url));
  writeFileSync(target, `${JSON.stringify(await openApiDocument(), null, 2)}\n`);
  console.log(`wrote ${target}`);
  process.exit(0);
}
