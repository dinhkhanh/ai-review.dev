# Deployment

Production infrastructure for ai-review.dev, provisioned 2026-10-10. Secrets live only in
`.env.production.local` (gitignored, mode 600) and in each platform's secret store.

## Inventory

| Resource | Where                                     | Identifier                                                            | Notes                                                     |
| -------- | ----------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| Web      | Vercel, team SuZu Group                   | `ai-review-web` (root `apps/web`)                                     | Domain `ai-review.dev` attached                           |
| CMS      | Vercel, team SuZu Group                   | `ai-review-cms` (root `apps/cms`)                                     | Domain `admin.ai-review.dev` to add                       |
| API      | Vercel, team SuZu Group                   | `ai-review-api` (root `apps/api`, Hono preset)                        | Domain `api.ai-review.dev` attached                       |
| Database | Supabase org SuZu Group (Pro)             | project `ai-review`, ref `ludkxxthvuhjxurticyk`, us-east-1            | Postgres 17; pgvector via migration                       |
| Cache    | Upstash                                   | Redis `ai-review`, us-east-1, free plan                               | REST API used from Vercel functions                       |
| Media    | Cloudflare account tran@dinhkhanh.dk      | R2 bucket `ai-review-media` (ENAM)                                    | Public via r2.dev URL (custom domain later)               |
| Errors   | Sentry org `suzu-group`, team `ai-review` | `ai-review-web`, `ai-review-cms`, `ai-review-api`, `ai-review-worker` | DSNs set on the Vercel projects                           |
| Worker   | Trigger.dev                               | project ref in `TRIGGER_PROJECT_REF`                                  | Pipeline, video and the daily crons (see Phase 2 rollout) |

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
   Check with `node scripts/prod.mjs env:check`: it lists, per destination, what is still missing
   (names only). Destinations live in `scripts/env-targets.json`: the Vercel projects get only what
   they use (no R2 credentials, just the public `NEXT_PUBLIC_MEDIA_URL`); the Trigger.dev worker,
   which uploads media, gets the R2 and AI keys when you deploy it (step 4).
2. **Push to Vercel and migrate** (adds migrations `0003`/`0004`: media blobs, comments, step logs,
   published versions):
   ```sh
   node scripts/prod.mjs env:push
   node scripts/prod.mjs db:migrate
   node scripts/prod.mjs db:seed     # adds the new settings keys; keeps existing values
   ```
3. **Use the Trigger.dev production key on the CMS.** `TRIGGER_SECRET_KEY` in
   `.env.production.local` must be the **Production** secret key (`tr_prod_…`, Trigger.dev
   dashboard → API keys → Production), not the dev key (`tr_dev_…`, which only reaches a local
   `trigger dev` session). Then `node scripts/prod.mjs env:push` and redeploy the CMS.
4. **Deploy the worker to Trigger.dev** (needs `npx trigger.dev@4.7.3 login` once). The deploy syncs
   the worker variables from `.env.production.local` (see `apps/worker/trigger.config.ts`):
   ```sh
   pnpm --filter worker run deploy
   ```
   Until the worker is deployed, jobs created in the production CMS stay queued (the CMS shows a
   notice). Locally, `pnpm --filter worker runner` processes queued jobs.
5. **Voyage billing (optional).** Without a payment method Voyage allows 3 requests/minute, so
   embeddings fail and retrieval uses Postgres full-text search. Adding a payment method enables
   semantic retrieval; no code change needed.
6. **Plausible (optional).** Set `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=ai-review.dev` on `ai-review-web`.
7. **Preview database (optional).** Preview builds still fail without a preview `DATABASE_URL`.
8. **CI remote cache (optional).** Create a Vercel access token, add it as the `TURBO_TOKEN`
   repository secret and set the `TURBO_TEAM` repository variable to `suzu-group`.

## Phase 2 rollout (owner)

Every Phase 2 feature is optional and stays off (or degrades gracefully) until its keys exist.

1. **Migrate and seed** (migration `0005_phase2_foundation`; seed adds the new settings keys and keeps
   existing values):
   ```sh
   node scripts/prod.mjs db:migrate
   node scripts/prod.mjs db:seed
   ```
2. **Fill the Phase 2 values you want** in `.env.production.local` (section "Phase 2" of
   `.env.production.example`), then `node scripts/prod.mjs env:check` and `env:push`:
   - Notifications: `RESEND_API_KEY` + `NOTIFY_EMAIL_FROM` (verified sender), and/or
     `NOTIFY_WEBHOOK_URL` (Slack incoming webhook), `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
     Recipients are set in CMS Settings (`notifications.recipients`).
   - Turnstile: `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (votes, reports, newsletter).
   - Analytics: `PLAUSIBLE_API_KEY` (+ `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`) for page-view import.
   - Networks: `IMPACT_ACCOUNT_SID`/`IMPACT_AUTH_TOKEN`, `PARTNERSTACK_API_KEY`,
     `AWIN_API_TOKEN`/`AWIN_PUBLISHER_ID` for conversion sync. CSV import works without them.
   - CMS media: the CMS now also gets the `R2_*` values so generated and processed images go to R2.
   - Images: `FAL_KEY`. Sourcing: `PRODUCT_HUNT_TOKEN` (without it only Hacker News is used).
   - Video: `ELEVENLABS_API_KEY`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and the refresh
     token from `pnpm --filter worker youtube-auth` (Desktop OAuth client, YouTube Data API v3
     enabled, sign in as the channel owner) as `YOUTUBE_REFRESH_TOKEN`.
3. **Redeploy the worker** (`pnpm --filter worker run deploy`). It now prebuilds the Remotion bundle
   and registers the new tasks: `refresh-scheduler`, `link-health`, `affiliate-reminders`,
   `sync-conversions`, `import-page-views`, `product-sourcing`, `search-backfill`, `video-autogen`,
   plus on-demand tasks the CMS triggers. Rendered videos need R2 (the DB fallback refuses files over
   50 MB); the first render in a container downloads Chrome (~94 MB).
4. **Redeploy web, CMS and API** (push to main). New routes: `/compare`, `/alternatives`, `/best`,
   `/search`, `/deals`, `/newsletter/*`; API `/v1/guides`, `/v1/search`, `/v1/deals` and the visitor
   write endpoints (API version 1.3.0).
5. **Switch features on in CMS Settings** when ready: `sourcing.policy.enabled`,
   `affiliate.catchAllFallback` (network + publisher id), `pipeline.videoEnabled` and
   `video.settings`, auto-publish (`publishing.autoPublishCategories` and, deliberately,
   `publishing.requireHumanReview = false`). Refresh and link health are on by default.

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
