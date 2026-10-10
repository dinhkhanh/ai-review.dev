# Deployment

Production infrastructure for ai-review.dev, provisioned 2026-10-10. Secrets live only in
`.env.production.local` (gitignored, mode 600) and in each platform's secret store.

## Inventory

| Resource | Where                                     | Identifier                                                            | Notes                               |
| -------- | ----------------------------------------- | --------------------------------------------------------------------- | ----------------------------------- |
| Web      | Vercel, team SuZu Group                   | `ai-review-web` (root `apps/web`)                                     | Domain `ai-review.dev` attached     |
| CMS      | Vercel, team SuZu Group                   | `ai-review-cms` (root `apps/cms`)                                     | Domain `admin.ai-review.dev` to add |
| API      | Vercel, team SuZu Group                   | `ai-review-api` (root `apps/api`, Hono preset)                        | Domain `api.ai-review.dev` attached |
| Database | Supabase org SuZu Group (Pro)             | project `ai-review`, ref `ludkxxthvuhjxurticyk`, us-east-1            | Postgres 17; pgvector via migration |
| Cache    | Upstash                                   | Redis `ai-review`, us-east-1, free plan                               | REST API used from Vercel functions |
| Media    | Cloudflare account tran@dinhkhanh.dk      | R2 bucket `ai-review-media` (ENAM)                                    | Public access decided in Phase 1    |
| Errors   | Sentry org `suzu-group`, team `ai-review` | `ai-review-web`, `ai-review-cms`, `ai-review-api`, `ai-review-worker` | DSNs set on the Vercel projects     |
| Worker   | Trigger.dev                               | not created yet                                                       | Needs your login                    |

Vercel functions run in `iad1`, next to the database. All three projects use Node 24, pnpm 11 via
Corepack, and skip builds when their directory and dependencies did not change.

## Environment variables on Vercel

Set by provisioning: public URLs, Sentry DSNs, `ENABLE_EXPERIMENTAL_COREPACK`, and from
`.env.production.local`: `BETTER_AUTH_SECRET` (cms), `REVALIDATE_SECRET` (web, cms),
`UPSTASH_REDIS_REST_URL` (all).

Still empty until you fill `.env.production.local` and run `node scripts/prod.mjs env:push`:
`DATABASE_URL` (all three), `UPSTASH_REDIS_REST_TOKEN` (all three), `TRIGGER_SECRET_KEY` (cms).

Database variables target **production only**, so preview deployments cannot touch production
data. Preview builds of web and cms fail until a separate preview database exists (Phase 1).

## Remaining steps (owner)

1. **Database URLs.** Supabase dashboard -> project `ai-review` -> Connect. Copy the
   _Transaction pooler_ URI into `DATABASE_URL` and the _Session pooler_ URI into
   `DATABASE_URL_MIGRATIONS` in `.env.production.local`. Use "Reset database password" there if
   you do not have it.
2. **Upstash token.** Upstash console -> `ai-review` -> REST API -> copy the token into
   `UPSTASH_REDIS_REST_TOKEN`.
3. **Push, migrate, seed.**
   ```sh
   node scripts/prod.mjs env:push
   node scripts/prod.mjs db:migrate
   node scripts/prod.mjs db:seed
   ```
4. **Domains.** Vercel -> `ai-review-cms` -> Domains -> add `admin.ai-review.dev`.
   Vercel -> `ai-review-web` -> Domains -> add `www.ai-review.dev` redirecting (308) to `ai-review.dev`.
5. **Trigger.dev.** Create a project named `ai-review` at cloud.trigger.dev, then:
   ```sh
   npx trigger.dev@4.7.3 login
   ```
   Put the project ref in `TRIGGER_PROJECT_REF` (root `.env`) and the production secret key in
   `TRIGGER_SECRET_KEY` (`.env.production.local`). In the Trigger.dev dashboard, set the worker's
   environment variables: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, and
   `SENTRY_DSN` (worker DSN from Sentry).
6. **R2 credentials (needed in Phase 1).** Cloudflare -> R2 -> Manage API tokens -> create an
   Object Read & Write token scoped to `ai-review-media`; store it as `R2_ACCESS_KEY_ID` /
   `R2_SECRET_ACCESS_KEY`.
7. **CI remote cache (optional).** Create a Vercel access token, add it as the `TURBO_TOKEN`
   repository secret and set the `TURBO_TEAM` repository variable to `suzu-group`.
8. **First deploy.** Push to `main`. Each Vercel project builds and deploys automatically.
   The repository is public, so pushing publishes the code (secrets are gitignored).

## Security notes

- Row-level security is enabled on every table (migration `0002_enable_rls`), so Supabase's
  auto-generated Data API cannot read application data. The app connects as the table owner and
  is unaffected. A test fails if a new table lacks RLS.
- The CMS requires TOTP 2FA for every account. Create the production admin with `db:seed`, then
  enrol 2FA on first sign-in at https://admin.ai-review.dev.
