import { spawn } from "node:child_process";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // fall through to the check below
}

if (!process.env.TRIGGER_PROJECT_REF) {
  console.log(
    "[worker] TRIGGER_PROJECT_REF is not set; skipping `trigger dev`.\n" +
      "[worker] Create a Trigger.dev project, set TRIGGER_PROJECT_REF in .env and run `npx trigger.dev@4.7.3 login` once.\n" +
      "[worker] Meanwhile `pnpm --filter worker runner` runs queued review jobs locally.",
  );
  process.exit(0);
}

const child = spawn("trigger", ["dev"], { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
