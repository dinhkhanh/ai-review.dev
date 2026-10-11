# Operations runbook

What to do when something breaks in production. Inventory, environment variables and rollout
steps live in [deploy.md](deploy.md). Commands run from the repo root unless noted.

## Where alerts arrive

| Signal                                                   | Channel                                                                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site, API or CMS down; SEO, disclosure or go-link broken | GitHub issue labelled `launch-check` (workflow `Launch check`, quick every 15 min, full daily 06:17 UTC). Also Telegram if `TELEGRAM_BOT_TOKEN`/`CHAT_ID` secrets are set. |
| Application exceptions                                   | Sentry org `suzu-group` (projects `ai-review-web`, `-cms`, `-api`, `-worker`)                                                                                              |
| Job finished/failed, review waiting, link broken, cost   | CMS `/notifications`, emailed to `notifications.recipients`, plus `NOTIFY_WEBHOOK_URL` / Telegram                                                                          |
| Backup or restore drill failed                           | Failed run of the `Database backup` workflow (GitHub emails the workflow author)                                                                                           |

Reproduce any launch-check alert locally. It only sends GETs, with a bot User-Agent, so go-link
clicks are flagged as bots:

```sh
pnpm launch-check --site https://ai-review.dev --api https://api.ai-review.dev --cms https://admin.ai-review.dev --mode full
# against local production builds: add --local (skips HSTS/TLS, tolerates another advertised port)
```

## Triage

**Site or API down** (`health.web` / `health.api` fail)

1. `curl -s https://ai-review.dev/api/health` and `curl -s https://api.ai-review.dev/v1/health`. A
   `503 {"db":"error"}` means the app is up but Postgres is not reachable. Go to "Database hangs".
2. Vercel dashboard → project → Deployments: did a deploy just go out? If so, roll back (below).
3. Check Vercel status and Supabase status pages. Functions run in `iad1`, the database in us-east-1.

**Database hangs or timeouts** (requests hang, then time out)

- The apps connect through the Supabase transaction pooler (port 6543), where postgres.js must run
  with `prepare: false` and `max_pipeline: 1`. `packages/db/src/client.ts` sets both automatically
  for any `:6543` URL. If a new code path creates its own client, it must go through `createDb`.
- Supabase dashboard → Database → Connections: pool saturation. Reports → Query performance:
  long-running queries. Kill one with `select pg_cancel_backend(<pid>)`.
- Supabase Pro has daily backups and point-in-time recovery in the dashboard. Use those before
  our own dumps.

**Pipeline stuck or failing**

1. CMS → Jobs: open the job. Each step shows status, logs and cost. **Retry** resumes from the
   failed step and reuses the steps that succeeded. **Re-run** on a step repeats it and everything
   after it. **Cancel** stops the job.
2. Trigger.dev dashboard → Runs: filter by `review-product`. Health report from the CLI:
   `cd apps/worker && pnpm exec trigger report health`.
3. A job paused on its cost ceiling waits for **Approve and continue** on the job page. That is not
   a failure.
4. Recurring work starts from three dispatchers in `apps/worker/src/trigger/cron.ts`
   (`cron-daily` 02:50 UTC, `cron-hourly`, `cron-quarter-hourly`) plus `publish-scheduled`. If
   nothing recurring runs, check those four schedules in Trigger.dev first. The plan allows only 10
   schedules, so never add `schedules.task` for new jobs.

**Firecrawl rate limits** (429s in research steps)

- The adapter spaces calls to `FIRECRAWL_RPM` (default 10, the entry plan). Lower it on the worker
  if 429s persist, or raise it after upgrading the plan. Then redeploy the worker. Retry the failed
  step from the job page.

**Cost spike**

- CMS → Reports / Analytics: spend per job, step and model. A job costing more than
  `costs.alertMultiplier` × `costs.targetPerReviewUsd` raises a cost notification.
- Contain it: lower `costs.defaultCeilingUsd` (jobs pause above it), switch expensive steps to a
  cheaper model in `pipeline.stepModels`, and turn off the bulk sources below (refresh, sourcing,
  auto-translate, video).

## Kill switches (CMS → Settings)

| To stop                     | Setting                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Any new article going live  | `publishing.dailyCap` = `0` (first-time publishes are refused; edits to live articles still work) |
| Auto-publish without review | `publishing.requireHumanReview` = `true` (D-3 default)                                            |
| Scheduled refresh jobs      | `refresh.policy.enabled` = `false`                                                                |
| Product sourcing            | `sourcing.policy.enabled` = `false`                                                               |
| Auto-translation            | `i18n.policy.autoTranslate` = `[]`. Remove `"de"` from `enabledLocales` to hide German pages.     |
| Newsletter digest           | `newsletter.digest.enabled` = `false` (or `autoSend` = `false` to keep drafts only)               |
| Video generation            | `pipeline.videoEnabled` = `false`, `video.settings.autoGenerate` = `false`                        |
| Hands-on browser trials     | `pipeline.handsOnTrials` = `false`                                                                |
| Search Console import/decay | `searchConsole.policy.enabled` = `false`                                                          |
| Mobile price-alert pushes   | `mobile.push.priceAlerts` = `false`                                                               |
| Link-health auto-pausing    | `linkHealth.policy.enabled` = `false`                                                             |

To take one article down, archive it in the CMS article page. The state machine allows `archived`
from every state.

## Rollback

- **Web / CMS / API (Vercel):** Vercel dashboard → project (`ai-review-web`, `ai-review-cms`,
  `ai-review-api`) → Deployments → previous good deployment → **Instant Rollback**. CLI:
  `vercel rollback <deployment-url> --scope suzu-group`. Afterwards, revert the commit on `main`.
  Otherwise the next push redeploys the bad code.
- **Worker (Trigger.dev):** `cd apps/worker && pnpm exec trigger promote <previous-version>`. Find
  versions under Deployments in the dashboard. Runs in progress finish on the version they started on.
- **Database:** migrations are forward-only (drizzle, `packages/db/drizzle`). Do not hand-edit
  `drizzle.__drizzle_migrations`. To undo a migration, write a new one that reverses it, then apply
  it with `node scripts/prod.mjs db:migrate`. Keep migrations additive (new nullable columns and
  tables first, drop later) so a code rollback still runs against the newer schema. For data loss,
  use Supabase point-in-time recovery, or restore from our dump (below).

## Key rotation

Update `.env.production.local`, run `node scripts/prod.mjs env:push`, then redeploy the affected
projects. Worker variables sync on `pnpm --filter worker run deploy`.

- **`REVALIDATE_SECRET`** (web + CMS): the bearer token for `/api/revalidate`. It also seeds the
  daily salt for visitor/click IP hashes and, unless `INDEXNOW_KEY` is set, the IndexNow key. Rotate
  web and CMS together. Expect revalidation to fail between the two deploys, a one-day break in
  click de-duplication, and a new IndexNow key file. Set `INDEXNOW_KEY` before rotating to keep
  the old key.
- **`BETTER_AUTH_SECRET`** (CMS): signs sessions **and encrypts stored TOTP secrets and backup
  codes**. Rotating it signs everyone out, and existing 2FA enrolments can no longer be verified.
  Every admin must have 2FA reset and re-enrol. Rotate only after a suspected leak.
- **`VAULT_KEY`** (CMS + worker): versioned. Prepend a new key, e.g.
  `VAULT_KEY=2:<new base64>,1:<old base64>` (`openssl rand -base64 32`). Deploy both. CMS → `/vault`
  → **Re-encrypt with current key** moves every entry to version 2. Remove `1:` only after rotation reports zero
  remaining entries.
- **Provider API keys** (Anthropic, Firecrawl, Resend, R2, Upstash, networks): create the new key,
  push and redeploy, then revoke the old key in the provider dashboard.
- **Database password:** reset it in Supabase. Update `DATABASE_URL` on all three Vercel projects
  and the worker, and `BACKUP_DATABASE_URL` in GitHub secrets.

## Backups and restore

`.github/workflows/backup.yml` runs nightly at 03:30 UTC. It dumps the `public` and `drizzle`
schemas with `pg_dump -Fc`, encrypts the dump with `age` to `vars.BACKUP_AGE_RECIPIENT`, and uploads
it to R2 as `db/YYYY/MM/DD/aireview-<UTC stamp>.dump.age`. It prunes dumps older than
`BACKUP_RETENTION_DAYS` (default 35) but always keeps the newest 7. On the 1st of every month,
the `restore-drill` job restores the newest dump into a throwaway pgvector container and checks
row counts. Run either one manually from Actions → Database backup → Run workflow.

One-time setup:

1. Create R2 bucket `ai-review-backups` (not public, separate from media). Create an R2 API token
   with Object Read & Write on that bucket only.
2. Create a key pair with `age-keygen -o aireview-backup.key`. Store the private key offline (a
   password manager), never in the repo.
3. GitHub → Settings → Secrets: `BACKUP_DATABASE_URL`, the Supabase **session** pooler on port 5432
   (`postgres://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`) or
   the direct connection. Never port 6543. Also `R2_ACCOUNT_ID`, `R2_BACKUP_ACCESS_KEY_ID`,
   `R2_BACKUP_SECRET_ACCESS_KEY`, and `BACKUP_AGE_IDENTITY` (the private key file's contents, for the
   drill). Variables: `R2_BACKUP_BUCKET`, `BACKUP_AGE_RECIPIENT` (the `age1…` public key).

Manual restore (to a new Supabase project or a local database):

```sh
aws s3 cp s3://ai-review-backups/db/2026/10/12/aireview-20261012T033000Z.dump.age . \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
age --decrypt --identity aireview-backup.key --output aireview.dump aireview-*.dump.age
# Target needs vector, pg_trgm and citext in schema "extensions" (Supabase has them already;
# locally: create schema extensions; create extension vector schema extensions; ... ).
pg_restore --list aireview.dump | grep -v -E ' SCHEMA - public | COMMENT - SCHEMA public ' > restore.list
pg_restore --dbname "$TARGET_URL" --no-owner --no-privileges --exit-on-error --use-list restore.list aireview.dump
```

Then point `DATABASE_URL` at the restored database, redeploy, and run the launch check.
