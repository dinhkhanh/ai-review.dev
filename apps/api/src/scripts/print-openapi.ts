import { getDb } from "@repo/db";
import { createApp } from "../create-app";

/** Prints the OpenAPI document; used to generate the typed mobile client in Phase 1. */
const res = await createApp({ db: getDb() }).request("/openapi.json");
console.log(JSON.stringify(await res.json(), null, 2));
process.exit(0);
