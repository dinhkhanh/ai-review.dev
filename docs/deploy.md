# Deployment

Production infrastructure for ai-review.dev, provisioned 2026-10-10. Secrets live only in
`.env.production.local` (gitignored, mode 600) and in each platform's secret store.

## Inventory

| Resource | Where                                     | Identifier                                                            | Notes                                       |
| -------- | ----------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| Web      | Vercel, team SuZu Group                   | `ai-review-web` (root `apps/web`)                                     | Domain `ai-review.dev` attached             |
| CMS      | Vercel, team SuZu Group                   | `ai-review-cms` (root `apps/cms`)                                     | Domain `admin.ai-review.dev` to add         |
| API      | Vercel, team SuZu Group                   | `ai-review-api` (root `apps/api`, Hono preset)                        | Domain `api.ai-review.dev` attached         |
| Database | Supabase org SuZu Group (Pro)             | project `ai-review`, ref `ludkxxthvuhjxurticyk`, us-east-1            | Postgres 17; pgvector via migration         |
| Cache    | Upstash                                   | Redis `ai-review`, us-east-1, free plan                               | REST API used from Vercel functions         |
| Media    | Cloudflare account tran@dinhkhanh.dk      | R2 bucket `ai-review-media` (ENAM)                                    | Public via r2.dev URL (custom domain later) |
| Errors   | Sentry org `suzu-group`, team `ai-review` | `ai-review-web`, `ai-review-cms`, `ai-review-api`, `ai-review-worker` | DSNs set on the Vercel projects             |
| Worker   | Trigger.dev                               | project ref in `TRIGGER_PROJECT_REF`                                  | Tasks `review-product`, `publish-scheduled` |

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

## Phase 1 rollout (owner)

Phase 0 steps (database URLs, Upstash token, migrate/seed, domains) are done. For Phase 1:

1. **Fill the new values in `.env.production.local`** (see `.env.production.example`, section
   "Phase 1"): `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `VOYAGE_API_KEY` (optional), the four `R2_*`
   values, `NEXT_PUBLIC_MEDIA_URL` and `NEXT_PUBLIC_SITE_URL`.
2. **Push to Vercel and migrate** (adds migrations `0003`/`0004`: media blobs, comments, step logs,
   published versions):
   ```sh
   node scripts/prod.mjs env:push
   node scripts/prod.mjs db:migrate
   node scripts/prod.mjs db:seed     # adds the new settings keys; keeps existing values
   ```
3. **Deploy the worker to Trigger.dev** (needs `npx trigger.dev@4.7.3 login` once). The deploy syncs
   the worker variables from `.env.production.local` (see `apps/worker/trigger.config.ts`):
   ```sh
   pnpm --filter worker run deploy
   ```
   Until the worker is deployed, jobs created in the production CMS stay queued (the CMS shows a
   notice). Locally, `pnpm --filter worker runner` processes queued jobs.
4. **Voyage billing (optional).** Without a payment method Voyage allows 3 requests/minute, so
   embeddings fail and retrieval uses Postgres full-text search. Adding a payment method enables
   semantic retrieval; no code change needed.
5. **Plausible (optional).** Set `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=ai-review.dev` on `ai-review-web`.
6. **Preview database (optional).** Preview builds still fail without a preview `DATABASE_URL`.
7. **CI remote cache (optional).** Create a Vercel access token, add it as the `TURBO_TOKEN`
   repository secret and set the `TURBO_TEAM` repository variable to `suzu-group`.

## How the pieces talk

- CMS "New review" creates a `review_jobs` row and triggers the `review-product` task with the job
  id. The task runs `runReviewJob` (packages/pipeline), which persists every step; retries resume.
- Publishing in the CMS calls the web app's `POST /api/revalidate` (Bearer `REVALIDATE_SECRET`)
  and pings IndexNow (key served at `/<key>.txt`, derived from `REVALIDATE_SECRET` unless
  `INDEXNOW_KEY` is set). Scheduled articles are published by the `publish-scheduled` cron.
- `/go/:slug` reads the go-link table from Upstash (60 s) and Postgres; CMS link/program edits
  delete the Redis key, so new affiliate links apply within a minute without a deploy.
- Media: the worker uploads WebP originals and variants to R2. Without R2 credentials it stores
  bytes in Postgres (`media_blobs`) and the web app serves them at `/media/...`.

## Security notes

- Row-level security is enabled on every table (migration `0002_enable_rls`), so Supabase's
  auto-generated Data API cannot read application data. The app connects as the table owner and
  is unaffected. A test fails if a new table lacks RLS.
- The CMS requires TOTP 2FA for every account. Create the production admin with `db:seed`, then
  enrol 2FA on first sign-in at https://admin.ai-review.dev.
