// Production helpers. Reads .env.production.local; never prints secret values.
//   node scripts/prod.mjs env:check    show which variables each destination still lacks (no values)
//   node scripts/prod.mjs env:push     push env vars to the Vercel projects (production target)
// The Trigger.dev worker gets its variables (incl. R2) on `pnpm --filter worker run deploy`.
// Destinations are listed in scripts/env-targets.json.
//   node scripts/prod.mjs db:migrate   apply migrations to the production database
//   node scripts/prod.mjs db:seed      seed categories/settings and create the first admin
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEAM = "suzu-group";
const FILE = ".env.production.local";

/** Which variables go where (shared with apps/worker/trigger.config.ts). */
const TARGETS = JSON.parse(readFileSync(new URL("./env-targets.json", import.meta.url), "utf8"));
const PROJECTS = TARGETS.vercel;
/** Non-secret values are stored as "encrypted" (readable in the dashboard); secrets as "sensitive". */
const NOT_SECRET = new Set(TARGETS.public);
const OPTIONAL = new Set(TARGETS.optional);

function loadEnv() {
  let text;
  try {
    text = readFileSync(FILE, "utf8");
  } catch {
    console.error(`${FILE} not found. Copy .env.production.example and fill it in.`);
    process.exit(1);
  }
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2].trim()) env[m[1]] = m[2].trim();
  }
  return env;
}

function require(env, keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    console.error(`Missing in ${FILE}: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function envPush(env) {
  const dir = mkdtempSync(join(tmpdir(), "aireview-env-"));
  try {
    for (const [project, keys] of Object.entries(PROJECTS)) {
      for (const key of keys) {
        if (!env[key]) {
          console.log(`skip  ${project.padEnd(14)} ${key} (empty)`);
          continue;
        }
        const body = { key, value: env[key], target: ["production"], type: NOT_SECRET.has(key) ? "encrypted" : "sensitive" };
        const file = join(dir, "body.json");
        writeFileSync(file, JSON.stringify(body), { mode: 0o600 });
        try {
          execFileSync("vercel", ["api", `/v10/projects/${project}/env?upsert=true`, "--method", "POST", "--input", file, "--scope", TEAM], {
            stdio: ["ignore", "ignore", "pipe"],
          });
          console.log(`set   ${project.padEnd(14)} ${key}`);
        } catch (error) {
          const msg = String(error.stderr ?? error.message).split("\n").find((l) => l.trim()) ?? "failed";
          console.log(`FAIL  ${project.padEnd(14)} ${key}: ${msg.replaceAll(env[key], "***")}`);
          process.exitCode = 1;
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("\nRedeploy each project (or push to main) for new values to take effect.");
  console.log("Worker variables (R2, AI keys...) sync to Trigger.dev on `pnpm --filter worker run deploy`.");
}

/** Lists, per destination, the variables still empty in the file. Never prints values. */
function envCheck(env) {
  const destinations = [
    ...Object.entries(PROJECTS).map(([name, keys]) => [`Vercel ${name}`, keys]),
    ["Trigger.dev worker (on deploy)", TARGETS.trigger],
  ];
  let missingRequired = 0;
  for (const [name, keys] of destinations) {
    const missing = keys.filter((k) => !env[k]);
    const required = missing.filter((k) => !OPTIONAL.has(k));
    missingRequired += required.length;
    const note = missing.length ? `missing: ${missing.map((k) => (OPTIONAL.has(k) ? `${k} (optional)` : k)).join(", ")}` : "complete";
    console.log(`${required.length ? "✗" : "✓"} ${name.padEnd(32)} ${note}`);
  }
  if (env.TRIGGER_SECRET_KEY && !env.TRIGGER_SECRET_KEY.startsWith("tr_prod_")) {
    console.log("✗ TRIGGER_SECRET_KEY is not a production key (expected tr_prod_…)");
    missingRequired++;
  }
  process.exitCode = missingRequired ? 1 : 0;
}

function run(cmd, args, extraEnv) {
  execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
}

const env = loadEnv();
const command = process.argv[2];
if (command === "env:push") {
  envPush(env);
} else if (command === "env:check") {
  envCheck(env);
} else if (command === "db:migrate") {
  require(env, ["DATABASE_URL_MIGRATIONS"]);
  run("pnpm", ["--filter", "@repo/db", "exec", "tsx", "src/scripts/migrate.ts"], { DATABASE_URL: env.DATABASE_URL_MIGRATIONS });
} else if (command === "db:seed") {
  require(env, ["DATABASE_URL_MIGRATIONS", "BETTER_AUTH_SECRET", "SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD"]);
  const vars = {
    DATABASE_URL: env.DATABASE_URL_MIGRATIONS,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: "https://admin.ai-review.dev",
    NEXT_PUBLIC_CMS_URL: "https://admin.ai-review.dev",
    SEED_ADMIN_EMAIL: env.SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD,
  };
  run("pnpm", ["--filter", "@repo/db", "exec", "tsx", "src/scripts/seed.ts"], vars);
  run("pnpm", ["--filter", "@repo/auth", "exec", "tsx", "src/scripts/create-admin.ts"], vars);
  console.log(`\nAdmin password is SEED_ADMIN_PASSWORD in ${FILE}. Enrol 2FA on first sign-in.`);
} else {
  console.log("Usage: node scripts/prod.mjs <env:check|env:push|db:migrate|db:seed>");
  process.exit(1);
}
