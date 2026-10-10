# ai-review.dev

AI-assisted reviews of SaaS and digital products, monetised through affiliate links.
Requirements live in [`docs/srs.md`](docs/srs.md); architecture and roadmap in [`docs/plan.md`](docs/plan.md).

## Quick start

Requirements: Node 24+, pnpm 11, Docker.

```sh
pnpm install
pnpm setup        # creates .env with secrets, starts Postgres (port 55432), migrates, seeds
pnpm dev          # web :3000, cms :3001, api :3002 (worker skips until Trigger.dev is configured)
```

Sign in to the CMS at http://localhost:3001 with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`.
Two-factor enrolment is mandatory on first sign-in.

## Layout

| Path                 | What it is                                                                              |
| -------------------- | --------------------------------------------------------------------------------------- |
| `apps/web`           | Public site (Next.js 16, ISR)                                                           |
| `apps/cms`           | Admin CMS (Next.js 16, Better Auth + TOTP 2FA)                                          |
| `apps/api`           | Public REST API v1 (Hono, OpenAPI 3.1 at `/openapi.json`, docs at `/docs`)              |
| `apps/worker`        | Pipeline orchestration (Trigger.dev v4)                                                 |
| `apps/mobile`        | Expo app (SDK 57): reader, search, saved items, price alerts; English and German        |
| `packages/db`        | Drizzle schema, migrations, seed, test helpers                                          |
| `packages/core`      | Domain services (products, jobs, cost ledger, settings, audit)                          |
| `packages/ai`        | Claude wrapper (effort, caching, refusal fallback, cost tracking) and Firecrawl adapter |
| `packages/pipeline`  | Step contract and executor (validation, persistence, resume, per-step costs), prompts   |
| `packages/content`   | Portable article blocks, fact sheet, SEO and rubric schemas, launch taxonomy            |
| `packages/affiliate` | Program, link-format and status schemas (link builder and resolver arrive in Phase 1)   |
| `packages/auth`      | Better Auth configuration and browser client                                            |
| `packages/contracts` | API v1 Zod/OpenAPI schemas shared with the future mobile app                            |
| `packages/graphics`  | Deterministic OG images (Satori + resvg)                                                |
| `packages/ui`        | Design tokens, Tailwind v4 theme, base components                                       |

Internal packages are just-in-time: they export TypeScript source, compiled by Next.js, tsup (API) and the Trigger.dev bundler.

## Common commands

```sh
pnpm turbo run lint check-types test build   # what CI runs
pnpm db:generate                              # after editing packages/db/src/schema
pnpm db:migrate && pnpm db:seed
pnpm --filter worker smoke [--llm]            # pipeline smoke test (--llm makes one tiny Haiku call)
pnpm --filter api openapi                     # print the OpenAPI document
pnpm --filter api generate-client             # refresh packages/contracts after API changes
pnpm --filter mobile dev                      # Expo dev server (set EXPO_PUBLIC_API_URL to your LAN API)
```

Tests use a separate database per package, created from `TEST_DATABASE_URL`, so Turborepo can run them in parallel.

## Environment

Every app reads the repo-root `.env` in development (see `.env.example`). Turborepo runs in strict env mode,
so any new variable must be listed in `turbo.json`; `eslint-plugin-turbo` warns when one is missing.
