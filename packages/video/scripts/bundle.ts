import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundleProject } from "../src/render";

/** Prebuilds the Remotion bundle into packages/video/build (shipped with the worker deploy). */
const outDir = fileURLToPath(new URL("../build", import.meta.url));
await rm(outDir, { recursive: true, force: true });
const dir = await bundleProject(outDir);
console.log(`Remotion bundle written to ${dir}`);
