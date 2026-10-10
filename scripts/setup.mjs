// One-time local setup: `pnpm setup`.
// Creates .env with generated secrets (if missing), starts Postgres, migrates and seeds.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (!existsSync(".env")) {
  let env = readFileSync(".env.example", "utf8");
  const fill = (key, value) => {
    env = env.replace(new RegExp(`^${key}=$`, "m"), `${key}=${value}`);
  };
  fill("BETTER_AUTH_SECRET", randomBytes(32).toString("base64"));
  fill("SEED_ADMIN_PASSWORD", randomBytes(15).toString("base64url"));
  fill("REVALIDATE_SECRET", randomBytes(24).toString("hex"));
  writeFileSync(".env", env, { mode: 0o600 });
  console.log("Created .env with generated secrets. Add your API keys (ANTHROPIC_API_KEY, FIRECRAWL_API_KEY) there.");
} else {
  console.log(".env exists; leaving it unchanged.");
}

run("docker compose up -d --wait postgres");
run("pnpm db:migrate");
run("pnpm db:seed");
console.log("\nDone. Run `pnpm dev`, then sign in at http://localhost:3001 with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from .env.");
