# AI Review — Technical Plan

Companion to `docs/srs.md`. This document records the architecture, the stack decisions (with the alternatives rejected), the pipeline design, the cost model and the phased roadmap. Date: 2026-10-10.

---

## 1. Business model in one paragraph

Visitors search "X review", "X pricing", "X vs Y", "best X for Z". We rank with trustworthy, evidence-backed, frequently refreshed reviews. Every page carries CTAs through our go-link redirect, which resolves to the best available affiliate link. Revenue grows with (a) number of indexed pages × (b) traffic per page × (c) click-through × (d) commission. The pipeline drives (a) at low marginal cost; quality gates and freshness protect (b); the affiliate engine maximises (c) and (d).

---

## 2. Monorepo layout

```
ai-review.dev/
├── apps/
│   ├── web/        Next.js (App Router) public site — ai-review.dev
│   ├── cms/        Next.js admin — admin.ai-review.dev (auth, pipeline dashboard, editor, affiliate workspace)
│   ├── api/        Hono + OpenAPI public/mobile REST API — api.ai-review.dev
│   ├── worker/     Durable task runner: pipeline orchestration, renders, cron (health checks, refresh)
│   └── mobile/     (phase 3) Expo / React Native
├── packages/
│   ├── db/         Drizzle schema, migrations, typed client, pgvector helpers
│   ├── core/       Domain services (products, articles, affiliate, clicks, costs). No framework code.
│   ├── pipeline/   Pipeline steps as pure async functions + versioned prompts + step contracts (Zod)
│   ├── ai/         Provider adapters: llm (Anthropic), search/scrape (Firecrawl), embeddings, image, tts
│   ├── affiliate/  Network modules, link template builder, redirect resolver, health checker
│   ├── graphics/   Satori templates (OG, pricing card, pros/cons, score badge) → PNG/SVG
│   ├── video/      Remotion compositions (short + long), caption renderer
│   ├── content/    Block schema (portable JSON), renderers to React (web) and plain structures (API), schema.org builders
│   ├── contracts/  Zod schemas + generated OpenAPI types + generated TS API client (shared with mobile)
│   ├── ui/         Shared React components (shadcn/ui based), design tokens, Tailwind preset
│   ├── eslint-config/, typescript-config/   (existing)
└── docs/           srs.md, plan.md, adr/ (architecture decision records added as we go)
```

Dependency rule: `apps/* → packages/*`; `core → db`; `pipeline → ai, core, affiliate, graphics`; nothing imports from `apps/*`. Enforced with Turborepo boundaries / ESLint import rules.

The create-turbo placeholders `apps/web` and `apps/docs` have already been deleted from the working tree; the apps above are scaffolded fresh.

---

## 3. Stack decisions

| Area                   | Decision                                                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                                                  | Rejected alternatives                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / tooling     | TypeScript everywhere, pnpm 11, Turborepo 2.11, Node 24                                                                                                                                                                                                                                                                                                             | Already in repo; one language across web, API, worker, mobile.                                                                                       | —                                                                                                                                                                         |
| Public web             | Next.js App Router on Vercel, static + ISR with tag-based revalidation                                                                                                                                                                                                                                                                                              | Best-in-class SEO primitives (metadata API, sitemaps, OG image generation), ISR gives cheap pages that survive backend outages.                      | Astro (great for static, weaker for CMS-driven revalidation and shared React with mobile tooling).                                                                        |
| Admin CMS              | Custom Next.js app with shadcn/ui, TanStack Table/Query, Tiptap-based block editor                                                                                                                                                                                                                                                                                  | The core admin surface is a pipeline dashboard and a review queue, not generic content CRUD; a generic CMS would fight us.                           | Payload CMS 3 (excellent admin for free, but pipeline/QA UI would still be custom and it adds a second data model), Strapi, Directus.                                     |
| Auth (admin)           | Better Auth with email+password, TOTP/passkey 2FA, roles                                                                                                                                                                                                                                                                                                            | Self-hosted, Next.js-native, no per-user pricing.                                                                                                    | Clerk (fine, paid), Auth.js (weaker 2FA story).                                                                                                                           |
| API                    | Hono with `@hono/zod-openapi`, deployed as Node on Vercel (portable to Cloudflare Workers)                                                                                                                                                                                                                                                                          | Tiny, fast, generates the OpenAPI spec from the same Zod schemas the DB layer uses; typed client generated for mobile.                               | tRPC (no OpenAPI without extra tooling; mobile wants REST), Next route handlers only (ties API to the web deploy).                                                        |
| Worker / orchestration | **Trigger.dev v4** tasks in `apps/worker`; steps are plain functions in `packages/pipeline` so the orchestrator is swappable                                                                                                                                                                                                                                        | Durable, long-running (hours), per-step retries, concurrency limits, cron, run dashboard, no server to babysit; supports ffmpeg/Playwright/Remotion. | BullMQ + Redis on a container (cheaper at scale, more ops; keep as the exit path), Inngest (step time limits on Vercel hurt video), Temporal (overkill for one operator). |
| Database               | Postgres on Supabase with pgvector; Drizzle ORM + drizzle-kit migrations                                                                                                                                                                                                                                                                                            | Managed Postgres, pgvector for research chunks, Supabase plugin already connected; Drizzle keeps SQL explicit and types shared.                      | Neon (equally good; pick Supabase for Storage/Auth optionality), Prisma (heavier runtime).                                                                                |
| Cache / rate limit     | Upstash Redis                                                                                                                                                                                                                                                                                                                                                       | Serverless-friendly; caches the go-link table and rate-limits public endpoints.                                                                      | Vercel KV (same thing, less portable).                                                                                                                                    |
| Object storage         | Cloudflare R2 (S3 API) behind a CDN domain `media.ai-review.dev`                                                                                                                                                                                                                                                                                                    | Zero egress cost for images/video; account already present.                                                                                          | Supabase Storage (fine fallback), S3.                                                                                                                                     |
| Click events           | Insert into Postgres via a queue (QStash or Trigger.dev event) from the redirect; monthly partitions                                                                                                                                                                                                                                                                | Simple, queryable with SQL, adequate up to millions of clicks/month.                                                                                 | ClickHouse/Tinybird (later if volume demands).                                                                                                                            |
| LLM                    | Anthropic Claude via `@anthropic-ai/sdk`. Default `claude-opus-5-5` with adaptive thinking and per-step effort; `claude-haiku-5-5` for bulk extraction/classification; `claude-sonnet-5-5` for mid-tier steps; Batches API for refresh jobs (50 % off); prompt caching on the style guide + fact sheet prefix; structured outputs for fact sheets and rubric scores | Quality of long-form writing and fact-checking is the product; cost is controlled by routing cheap steps to Haiku and caching.                       | Multi-vendor routing from day one (adds eval burden; adapter leaves the door open).                                                                                       |
| Web research           | Firecrawl (search, scrape → markdown, screenshots, maps) plus Claude's server-side `web_search`/`web_fetch` tools inside research agents                                                                                                                                                                                                                            | Firecrawl already connected; handles JS-rendered sites and returns clean markdown; Claude's tools complement for ad-hoc lookups.                     | Self-hosted Playwright for everything (needed anyway for hands-on in phase 3), SerpAPI.                                                                                   |
| Embeddings             | Adapter; Voyage AI `voyage-3` family recommended                                                                                                                                                                                                                                                                                                                    | Strong retrieval quality, simple API.                                                                                                                | OpenAI embeddings (fine), pgvector-only keyword search (weaker).                                                                                                          |
| Templated graphics     | Satori + resvg-js in the worker (and `next/og` for runtime OG fallback)                                                                                                                                                                                                                                                                                             | Deterministic, brand-consistent, free, fast.                                                                                                         | Headless Chrome screenshots of HTML (slower, heavier).                                                                                                                    |
| Generative images      | Adapter decided in phase 2 (candidates: Flux via fal.ai, Recraft, Google Imagen, OpenAI gpt-image)                                                                                                                                                                                                                                                                  | Not needed for MVP; templated graphics + real screenshots rank better and are safer.                                                                 | —                                                                                                                                                                         |
| TTS                    | Adapter; ElevenLabs (quality) or OpenAI TTS (price), word timestamps required                                                                                                                                                                                                                                                                                       | Captions need timestamps.                                                                                                                            | —                                                                                                                                                                         |
| Video                  | Remotion compositions rendered in the worker (ffmpeg) or Remotion Lambda when parallelism is needed                                                                                                                                                                                                                                                                 | React-based, reuses `packages/ui` tokens, deterministic.                                                                                             | HeyGen/HyperFrames (hosted, less control), Creatomate.                                                                                                                    |
| Email                  | Resend                                                                                                                                                                                                                                                                                                                                                              | Simple, generous free tier.                                                                                                                          | Postmark.                                                                                                                                                                 |
| Analytics              | Plausible (public) + our click/conversion tables; PostHog optional for CMS funnels                                                                                                                                                                                                                                                                                  | Privacy-friendly, lightweight script.                                                                                                                | GA4 (consent friction, heavy).                                                                                                                                            |
| Error tracking         | Sentry in all apps (MCP already connected)                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                    | —                                                                                                                                                                         |
| CI/CD                  | GitHub Actions: lint, types, tests, build with Turborepo remote cache; Vercel preview deploys; Trigger.dev deploy on main                                                                                                                                                                                                                                           | —                                                                                                                                                    | —                                                                                                                                                                         |

Decisions are recorded as ADRs in `docs/adr/` when implemented; this table is the index.

---

## 4. Runtime architecture

```
            ┌────────────────────────┐        ┌──────────────────────────┐
 Visitor ──▶│ apps/web (Vercel, ISR) │──SSR──▶│ packages/core → Postgres │
            │  /reviews /compare ... │        └──────────────────────────┘
            │  /go/:slug (edge)      │──302──▶ affiliate URL   ─┐ click event
            └────────────────────────┘                          ▼
                     ▲ revalidateTag()                   queue → clicks table
                     │
            ┌────────────────────────┐   enqueue job    ┌──────────────────────────┐
 Admin ────▶│ apps/cms (Vercel)      │─────────────────▶│ apps/worker (Trigger.dev)│
            │  intake, review, links │◀── status/webhook│  pipeline steps, cron    │
            └────────────────────────┘                  └───────┬──────────────────┘
                                                                │ adapters (packages/ai, affiliate)
                                                                ▼
                                            Claude · Firecrawl · Voyage · TTS · R2 · YouTube · networks

 Mobile (phase 3) ──▶ apps/api (Hono, OpenAPI) ──▶ packages/core → Postgres  (edge-cached by tag)
```

Key flows:

**Publish**: admin approves → `core.articles.publish()` writes `published_at`, bumps `current_version_id`, emits `article.published` → web `revalidateTag(article:slug | category:x | home | sitemap)` + IndexNow ping + API cache purge.

**Redirect**: `/go/:slug?p=cta_sticky` → read link table from Upstash (JSON per slug, TTL 60 s, refreshed on link change) → pick highest-priority `active` link for the country → render destination from the template with SubID `slug--placement` → 302 with `Cache-Control: no-store` → fire-and-forget click event. On cache miss, query Postgres; on any error, 302 to the vendor URL with UTM so the visitor never sees an error.

**Pipeline run**: CMS inserts `review_jobs` + triggers `reviewProduct` task → task fans out steps (research and affiliate discovery in parallel) → each step writes `job_steps` + `cost_ledger` → final step sets article `in_review` and notifies admin.

---

## 5. Pipeline design

| Step                                          | Inputs                                                            | Outputs                                                                    | Model / tool                                        | Effort | Notes                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `resolve_product`                             | name/URL                                                          | canonical product record, candidate list                                   | Haiku 5.5 + Firecrawl search                        | low    | Dedup by domain + name similarity.                                       |
| `crawl_official`                              | website_url                                                       | sources (markdown + screenshots) for ≤ 25 pages                            | Firecrawl map + scrape                              | —      | Prioritise pricing, features, docs, changelog, security.                 |
| `collect_third_party`                         | product name, competitors                                         | sources from G2/Capterra/PH/Reddit/HN/YouTube/news                         | Firecrawl search + scrape; YouTube transcript fetch | —      | Store ratings with date. Respect robots.                                 |
| `chunk_embed`                                 | sources                                                           | research_chunks with embeddings                                            | Voyage                                              | —      | ~800-token chunks, overlap 100.                                          |
| `extract_facts`                               | per-source chunks                                                 | per-source structured extractions                                          | Haiku 5.5, structured outputs                       | low    | Parallel, cheap; this is where most tokens go.                           |
| `fact_sheet`                                  | extractions                                                       | merged fact sheet with citations and confidence, diff vs previous          | Opus 5.5, structured outputs                        | high   | Conflicts resolved with recency + official-source preference.            |
| `affiliate_discovery`                         | product, domain                                                   | programs found with terms, link format, redirect policy, draft application | Sonnet 5.5 + Firecrawl + network modules            | medium | Runs in parallel with research.                                          |
| `competitors`                                 | fact sheet, sources                                               | 3–8 alternatives with positioning                                          | Sonnet 5.5                                          | medium | Links to existing products/articles when present.                        |
| `seo_brief`                                   | fact sheet, SERP scrape of target queries, existing site articles | keywords, intent, title, slug, outline, FAQ, internal links                | Opus 5.5                                            | medium | Optional keyword API later (DataForSEO).                                 |
| `write`                                       | fact sheet, brief, retrieved chunks, style guide (cached prefix)  | article blocks with claim→source citations, rubric scores                  | Opus 5.5, streaming                                 | high   | Section-by-section with a shared cached prefix; regenerable per section. |
| `fact_check`                                  | article claims, cited chunk text                                  | per-claim verdicts; auto-fix suggestions                                   | Opus 5.5                                            | high   | Blocks publish on unsupported claims.                                    |
| `style_pass`                                  | article                                                           | edited article + readability + banned-phrase report                        | Sonnet 5.5                                          | medium | Deterministic linters run first (reading level, length, clichés list).   |
| `graphics`                                    | fact sheet, scores, brand tokens                                  | OG image, pricing card, pros/cons card, score badge, processed screenshots | Satori/resvg, sharp                                 | —      | Uploaded to R2 with variants; alt text via Haiku.                        |
| `qa_gates`                                    | everything                                                        | scorecard JSON, hard-gate pass/fail                                        | code + Haiku for alt text/meta checks               | —      | Structured-data validation with schema-dts + Google's validator rules.   |
| `human_review`                                | —                                                                 | approve / changes requested                                                | admin                                               | —      | Default mandatory.                                                       |
| `publish`                                     | approved version                                                  | live page, sitemap, IndexNow, social snippets                              | code                                                | —      |                                                                          |
| `video_script` → `tts` → `render` → `youtube` | approved article, assets                                          | MP4 short + long, thumbnail, YouTube ID                                    | Sonnet 5.5; TTS adapter; Remotion; YouTube API      | medium | Phase 2. Never blocks publish.                                           |
| `refresh` (cron)                              | product                                                           | fact-sheet diff → partial re-write → in_review                             | as above                                            | —      | Phase 2; uses Batches API where latency is irrelevant.                   |
| `link_health` (cron)                          | affiliate links                                                   | health status, auto-pause, notification                                    | code (HTTP follow)                                  | —      | Phase 2.                                                                 |

Pipeline implementation rules:

- A step is `async (ctx, input) => output` with Zod-validated input/output; the orchestrator (Trigger.dev task) handles retries, persistence and the ledger. Steps never call the DB directly except through `core`.
- Prompts live in `packages/pipeline/prompts/<step>/vN.md` with front-matter (model default, effort, output schema ref). The CMS prompt editor writes new versions to the DB; the repo copy is the source of truth for defaults.
- Every LLM call goes through `packages/ai/llm` which: sets `thinking: {type: "adaptive"}` (omitted on models where it is always on), sets `output_config.effort` per step, enables prompt caching on the stable prefix (style guide, rubric, fact sheet), records usage → `cost_ledger`, handles `stop_reason === "refusal"` and `max_tokens`, and uses streaming for long outputs.
- Evals: `packages/pipeline/evals/` holds 10–20 golden products with expected fact-sheet fields and rubric ranges; run on prompt changes (phase 2, see risks).

---

## 6. Affiliate engine detail

**Program discovery** (`affiliate_discovery` step): check `https://<domain>/{affiliates,affiliate,partners,partner-program,referral,refer}`; query networks' public directories; web-search `"<product>" affiliate program`; classify results into a `programs` record with evidence URLs. Output includes `link_format`, e.g. `{ kind: "query_param", param: "via", value_source: "account" }`, `{ kind: "network_deeplink", network: "impact" }`, or `{ kind: "static_url" }`.

**Link template builder** (`packages/affiliate/links`): pure function `buildUrl(link, { subid, country })` that applies the program's format, appends SubID in the network's parameter (`subId1`, `sid`, `clickref`, `utm_content`, …), validates the result and never double-encodes. 100 % branch-tested.

**Resolver** (`packages/affiliate/resolve`): `resolve(slug, country) → { url, linkId, programId, fallback: boolean }` using the cached link table; implements priority, weights (A/B), date windows, region, redirect policy, and the vendor-URL fallback.

**Redirect endpoint**: `apps/web/app/go/[slug]/route.ts` on the edge runtime; emits the click event without awaiting persistence (`waitUntil`). Also mountable in `apps/api` for the mobile app. Bot filtering by UA list + rate heuristics at write time; `is_bot` kept rather than dropped.

**Network modules** (phase 2): `partnerstack`, `impact`, `awin`, `cj`, `rewardful`, `firstpromoter`, `tolt`, `lemonsqueezy`, `skimlinks` each export `discover?`, `buildLink`, `importConversions?`, `healthRules`. Conversions are matched to clicks by SubID; unmatched rows are kept for manual mapping.

**Compliance in code**: the block renderer wraps any URL that matches a go-slug or a known affiliate domain in `rel="sponsored nofollow noopener"` and injects the disclosure component on any page with ≥ 1 monetised link. Programs with `redirect_policy = forbidden` cause the renderer to emit the tracked URL directly (still logged via a `beacon` click event on the client).

---

## 7. Content model and mobile readiness

Article `blocks` is a JSON array of typed blocks: `heading`, `paragraph` (rich inline marks incl. `citation` and `golink`), `verdict` (score, one-liner), `rubric` (dimensions), `pricing_table`, `pros_cons`, `comparison_table`, `image`, `video`, `faq`, `cta`, `callout`, `sources`. Web renders blocks with React components; the API returns blocks plus resolved media variants; the mobile app renders the same blocks natively. No HTML is ever stored.

API versioning: `/v1` frozen once mobile ships; additive changes only; breaking changes go to `/v2`. The generated client in `packages/contracts` is what `apps/mobile` imports.

Design tokens in `packages/ui/tokens` (colours, radii, type scale, spacing) are plain JSON consumed by Tailwind on web and by NativeWind/StyleSheet on mobile.

---

## 8. Cost model (rough, per article, 2026-10 list prices)

| Item                                               | Assumption                                 | Cost       |
| -------------------------------------------------- | ------------------------------------------ | ---------- |
| Firecrawl crawl + search                           | ~60 pages, 10 searches                     | $0.30–0.60 |
| Extraction (Haiku 5.5)                             | 400K input, 40K output                     | $0.06      |
| Fact sheet + brief + write + fact-check (Opus 5.5) | ~180K input (60 % cache hits), ~30K output | $1.10–1.60 |
| Style pass, competitors, discovery (Sonnet 5.5)    | 60K in, 10K out                            | $0.22      |
| Embeddings                                         | 300K tokens                                | $0.02–0.06 |
| Graphics, storage, worker compute                  | —                                          | $0.05–0.20 |
| **Subtotal, quick review**                         |                                            | **≈ $2–3** |
| TTS (10–12K characters)                            | provider dependent                         | $0.30–2.00 |
| Video render compute + YouTube upload              | 2 renders                                  | $0.20–0.60 |
| **Total, full review with video**                  |                                            | **≈ $3–6** |

Fixed monthly at MVP scale: Vercel Pro $20, Supabase Pro $25, Trigger.dev free/hobby $0–50, Upstash ~$10, R2 <$5, Firecrawl plan $19–99, Resend $0, Plausible $9, Sentry $0–26 → roughly $85–245/month. Targets in SRS NFR-6 hold with margin.

---

## 9. Roadmap

### Phase 0 — Foundation (week of 2026-10-13, ~1 week)

- Scaffold `apps/web`, `apps/cms`, `apps/api`, `apps/worker`; packages `db`, `core`, `contracts`, `ui`, `ai`, `affiliate`, `pipeline`, `content`, `graphics`.
- Drizzle schema v1 for all entities in SRS §6; migrations; seed script (categories seeded with the launch set: AI tools, marketing, developer tools, hosting/servers, productivity, new releases); pgvector enabled.
- Better Auth in CMS with 2FA; roles; audit log.
- Turborepo tasks (`build`, `dev`, `lint`, `check-types`, `test`, `db:migrate`), GitHub Actions CI, Vercel projects, Trigger.dev project, R2 bucket, Upstash DB, Sentry.
- `packages/ai/llm` wrapper with usage ledger, caching, effort, refusal handling; `packages/ai/firecrawl` adapter.
- Exit: `pnpm dev` runs all apps; CI green; admin can log in.

### Phase 0 status (2026-10-10)

Done and verified locally (lint, types, 40 tests, production builds, end-to-end HTTP checks of sign-in and 2FA):

- Apps `web`, `cms`, `api`, `worker`; packages `db`, `core`, `ai`, `pipeline`, `content`, `affiliate`, `auth`, `contracts`, `graphics`, `ui`.
- Full Drizzle schema for SRS §6 (32 tables) with pgvector HNSW index; migrations; idempotent seed (launch categories, D-1..D-8 settings, editor author, first admin).
- Better Auth in the CMS: email + password (public sign-up off, 12+ chars, also enforced on admin routes), mandatory TOTP 2FA with backup codes, admin/editor roles, 12h sessions, audit log of sign-ins.
- `@repo/ai`: Claude wrapper (streaming, per-step effort, cached system prompt, `fallbacks: "default"` on supported models, typed refusal/truncation errors, structured outputs, per-model cost incl. fallback iterations) and Firecrawl adapter, both reporting to the cost ledger.
- `@repo/pipeline`: step contract + executor with Zod validation, idempotent attempts, failure recording and per-step cost attribution; `smoke` step and Trigger.dev `pipeline-smoke` task.
- CI workflow (GitHub Actions, pgvector service, optional Remote Cache).

Deviations from the plan above:

- Trigger.dev is on v4 (current release), not v3.
- Next.js 16 uses `proxy.ts` (formerly `middleware.ts`); the CMS uses it only for an optimistic cookie redirect. Authoritative checks run server-side.
- The graphics package ships the OG renderer now; pricing/pros-cons cards follow in Phase 1.
- Job and step cost columns are `numeric(12,6)` so sub-cent model calls are not rounded away.

Hosted resources were provisioned on 2026-10-10 (inventory and remaining owner steps in `docs/deploy.md`):
Vercel projects for web, cms and api; Supabase project `ai-review` (us-east-1); Upstash Redis; R2 bucket
`ai-review-media`; Sentry projects. Live Claude and Firecrawl calls are verified. Still open: database
and Upstash credentials on Vercel, two domains, the Trigger.dev project, R2 API token, Remote Cache token.

### Phase 1 — MVP: URL in, monetised review out (2026-10-20 → 2026-11-14, ~4 weeks)

- Intake UI + `resolve_product` + dedup (FR-INT-1/3/4/5).
- Research: crawl, third-party collection, chunk/embed, extraction, fact sheet with citations (FR-RES-1..6, 8).
- Affiliate discovery, programs/links CRUD, go-link redirect with fallback, click logging, auto-swap, redirect policy, disclosure enforcement (FR-AFF-1..4, 6..9, 14).
- Writing: SEO brief, article blocks, rubric, citations, fact-check, style pass, versions (FR-CON-1..6, 9..11).
- Graphics: OG, pricing card, pros/cons, badge, screenshot variants (FR-MED-1, 4, 5).
- QA scorecard, review state machine, review UI with section regenerate (FR-QA-1..3, 5).
- Web: home, category, review page, policy pages, ISR + revalidation, structured data, sitemaps, RSS, IndexNow, CTAs, consent, a11y (FR-WEB-1..6, 11, 12).
- API v1 read endpoints + OpenAPI + generated client (FR-API-1, 2, 5).
- CMS dashboard, job detail with retry/re-run, product record, settings with prompt versions (FR-CMS-1..5, 7).
- Cost ledger + per-job totals (FR-ANL-3 ledger), Plausible (FR-ANL-1).
- Exit: SRS §8 acceptance criteria pass on 5 real products across 2 categories.

### Phase 1 status (2026-10-10)

Built and verified locally (lint, types, unit/integration tests, production builds, a live run on
a real product):

- **Pipeline** (`packages/pipeline`): 14 persisted, resumable steps orchestrated by
  `runReviewJob` (resolve → crawl/third-party/affiliate in parallel → chunk/embed → extract → fact
  sheet → competitors → SEO brief → write → fact-check with repair → style pass → graphics → QA).
  Retry resumes from the last succeeded step; "re-run from step" marks downstream steps stale.
  Versioned prompts in `src/prompts`, CMS overrides and per-step model/effort settings.
- **Affiliate engine**: link builder and resolver with 100 % branch coverage, `/go/:slug` with
  country/priority/weight/date-window selection, vendor+UTM fallback, SubIDs, cookieless click
  logging after the response, Redis-cached link table, redirect-forbidden programs linked
  directly, disclosure and `rel="sponsored"` enforced by the renderer, 13-month click retention.
- **Web**: home, reviews list/search, review pages (ISR, JSON-LD validated before publish, sticky
  mobile CTA, sources, verified dates, report-a-change), categories, authors, policy pages,
  sitemap index + per-type sitemaps, RSS, IndexNow key and ping, media route for DB storage.
- **CMS**: intake with name→URL candidates and duplicate→refresh, jobs with step timeline/logs/
  costs and retry/re-run/cancel, products (identity, fact-sheet editor and diff, sources,
  affiliate programs/links, media alt text), article editor (block forms, section regenerate with
  instruction + fact-check, preview desktop/mobile, QA scorecard, fact-check claims, SEO, versions
  with diff/rollback, comments, state machine, publish/schedule), affiliate workspace, visitor
  reports, editable settings/prompts/rubrics/authors, integration status.
- **API**: `/v1/reviews`, `/v1/reviews/{slug}` (portable blocks), `/v1/products`,
  `/v1/products/{slug}`, `/v1/categories/{slug}`; OpenAPI committed in `packages/contracts` with a
  generated typed client (`@repo/contracts/client`) and a drift test.

Live verification (local DB, real APIs, product plausible.io): first run $1.74 / 20 min; refresh
produced fact sheet v2 with a 17-field diff and a new version of the same article (no duplicates).
Fact-check flagged 18 problems, repaired 14 and blocked publishing on the rest until edited; after
the editor fix the page published with valid JSON-LD, disclosure, six placement-coded CTAs and
sources. Moving claim verification to Sonnet with focused evidence cut fact-check cost from $2.20
to $0.53 per article (≈ $1.7 per quick review overall). Still open for the SRS §8 exit: run five
products across two categories in production once the worker is deployed.

Deviations and decisions:

- Media goes to R2 when configured; otherwise to Postgres (`media_blobs`) served by the web app.
- Public pages render the **published version**; pipeline refreshes and edits create new versions
  that go live only when published (`articles.published_version_id`).
- No consent banner: analytics is cookieless (Plausible) and click logging stores no cookies or
  raw IPs. Add a banner before introducing any cookie-setting script.
- Comparison, alternatives, best-of and deals endpoints/pages wait for those content types
  (Phase 2). Prompts are TypeScript modules rather than `.md` files (bundling for the worker).
- Model-facing schemas are kept flat; nested per-field wrappers exceeded the structured-output
  grammar limit (caught by the live run; `check-schemas` script added).
- Embeddings and Firecrawl degrade gracefully: embedding errors fall back to full-text retrieval,
  Firecrawl calls are paced (`FIRECRAWL_RPM`) and retried on rate limits.

### Phase 2 — Scale and monetise harder (2026-11-17 → 2026-12-19, ~5 weeks)

- Video pipeline: script, TTS, Remotion short + long, YouTube upload with disclosure flag, embed (FR-VID-1..5).
- Derivative content: comparisons, alternatives, best-of, social snippets (FR-CON-8, FR-INT-5 presets, FR-WEB-1 remaining pages).
- Network modules with deep-link APIs and conversion import; revenue attribution and funnel dashboards; link health cron (FR-AFF-4 APIs, 5, 10, 11, 12; FR-ANL-2, 4).
- Refresh scheduler with fact-sheet diffs, pricing-change handling, dead-product handling (FR-MNT-1, 2, 4; FR-RES-9).
- Originality check, auto-publish rules, notifications, media library, bulk intake, cost ceilings (FR-CON-7, FR-QA-4, FR-CMS-6 reports, 8, 9, FR-INT-2, 6).
- Product sourcing cron: new-launch feeds + network directories + commission data → "Suggested products" queue ranked by expected value (FR-INT-7). A lightweight manual version (admin pastes a Product Hunt or network URL) ships in phase 1.
- Search, deals, helpful votes/error reports, generative image adapter, screenshot annotation (FR-WEB-7, 8, 10; FR-MED-2, 3).
- Prompt evals on golden set; hill-climb the writing and fact-check prompts.
- Exit: 100+ published pages, first conversions attributed, refresh running unattended.

### Phase 2 status (2026-10-11)

Built and verified locally (lint, types and tests in all 44 Turborepo tasks; production builds of web,
CMS and API; live model checks noted below). One migration (`0005_phase2_foundation`) carries the
schema for everything here.

- **Operations:** notifications (CMS inbox + Resend email + Slack/Telegram webhooks, per-event
  channels, de-duplicated; FR-CMS-8); per-job cost ceilings that pause a job for approval, with a
  default ceiling setting and cost alerts at target × multiplier (FR-INT-6, NFR-6); bulk intake by
  pasted list or CSV, grouped in batches (FR-INT-2); auto-publish per category behind the global
  human-review switch, with soft-score threshold and daily-cap scheduling (FR-QA-4).
- **Freshness:** daily refresh scheduler (product interval, shorter for top-traffic pages from
  imported page views); refreshes of live articles check the site first, re-research, diff the fact
  sheet, rewrite only the affected sections and rebuild the pricing table, then fact-check and queue
  for review; no material change just re-verifies the date (FR-MNT-1, FR-MNT-2, FR-RES-9). A site that
  stays down marks the product discontinued: banner with reviewed alternatives, CTAs removed, links
  paused, refreshes stopped, one-click reactivate (FR-MNT-4).
- **Derivative content:** comparisons (2–3 products), alternatives lists and best-of lists written
  from existing fact sheets with per-product CTAs, comparison tables, multi-product fact-check and
  QA, Article + ItemList JSON-LD; pages `/compare`, `/alternatives`, `/best` (+ index pages, home,
  category, sitemap, feed) and `GET /v1/guides`; social posts for X/LinkedIn/Threads for every
  article (FR-CON-8).
- **Affiliate and revenue:** catch-all fallback via Skimlinks/Sovrn (FR-AFF-5); daily link health
  with auto-pause (FR-AFF-10); program reminders; conversion import by CSV and Impact /
  PartnerStack / Awin APIs with SubID attribution (FR-AFF-11, FR-AFF-12); `/analytics` with revenue,
  EPC, funnels from Plausible page views, costs and margins, CSV exports (FR-ANL-2/3/4).
- **Visitors:** site search on a GIN-indexed tsvector (FR-WEB-7), deals (FR-WEB-8), helpful votes and
  share buttons (FR-WEB-10), public write API for votes, reports and double-opt-in newsletter with
  rate limits and Turnstile (FR-API-3).
- **Media:** CMS media library with usage and alt editing (FR-CMS-9), screenshot crop/frame/annotate
  with browser-framed copies made by the graphics step (FR-MED-3), fal.ai image adapter with a fixed
  no-logos/no-UI prompt template (FR-MED-2).
- **Sourcing:** daily Product Hunt + Hacker News collection, Haiku category screening, affiliate
  probing and expected-value scoring into the CMS "Suggested products" queue (FR-INT-7).
- **Video:** script (Sonnet, length-checked), ElevenLabs voice with word timings, Remotion short
  (9:16) and long (16:9) renders with captions and QR outro, YouTube upload with the synthetic-media
  flag, CMS panel, lite embed + VideoObject (FR-VID-1..5). Sample renders verified locally.
- **Evals:** golden set of 10 products with sourced expectations, snapshot export, suites for
  `fact_sheet`, `write` and `fact_check`, repo-vs-CMS prompt comparison, results in `eval_runs` and
  the CMS. First real run on Plausible: fact sheet 100 %; fact-check recall 1.0 / precision 0.75 on
  six seeded errors ($0.27).

Deviations and decisions:

- Refreshes use the normal API, not the Batches API: a refresh rewrites a few sections, so the
  saving is small next to the added latency and code.
- A redirect to another domain is reported, not treated as dead (rebrands are common); only a site
  that stays down is marked discontinued.
- Auto-publish needs both the category opt-in and `publishing.requireHumanReview = false` (D-3 stays
  the default).
- Derivatives require researched products; the CMS lists only products with a fact sheet and the job
  fails with the names to research first.
- Generated-image prompts are a fixed template, not an LLM call (free, and the guardrails cannot be
  dropped). Product Hunt needs `PRODUCT_HUNT_TOKEN` in practice (its feed links are bot-blocked).
- Network "new programs" directories are not crawled; sourcing probes each candidate's own
  affiliate pages instead.

### Phase 3 — Mobile and growth (Q1 2027)

- `apps/mobile` (Expo): browse, search, review reader rendering blocks natively, saved items, price-change push alerts, deep/universal links (FR-API-4).
- Newsletter + digest (FR-WEB-9), Search Console import for decay detection (FR-MNT-3), A/B offers (FR-AFF-13), hands-on browser agent behind per-vendor opt-in (FR-RES-7), second locale.

### Phase 3 status (2026-10-11)

Built and verified locally: lint, types, tests and builds in all 50 Turborepo tasks, including
production builds of web, CMS and API, and an `expo export` bundle of the app. One migration
(`0006_phase3_foundation`) carries the schema. The second locale is **German** (owner decision): English
stays at unprefixed URLs, German lives under `/de`, formal "Sie".

- **Mobile (FR-API-4):** `apps/mobile` (Expo SDK 57, expo-router). Covers browse, search, saved items
  and price alerts, with a native reader for every content block. Deep links (`aireview://`) and
  universal/app links, served from `/.well-known` on the web app. German UI by device language.
  Anonymous device tokens (`Bearer <deviceId>.<secret>`, only the hash is stored). API endpoints
  `/v1/devices`, `/v1/me/saved`, `/v1/me/alerts` (API 1.4.0). Refreshes record plan-price changes in
  `price_changes`. The `price-alert-push` task sends Expo pushes every 15 minutes with a per-device
  daily cap, and `push-receipts` disables dead tokens.
- **Second locale:** web pages live under `app/[locale]` behind `proxy.ts`. UI strings come from typed
  message catalogues (`apps/web/messages`), German being complete or the build fails. Pages carry
  hreflang/x-default, sitemaps and RSS per locale, and a language switcher that finds the translated
  article. Affiliate labelling follows German practice ("Anzeige", asterisk + footnote). There are
  German legal pages and `/impressum`. Read API `?locale=en|de` with `alternates`; search uses the
  german text-search config for `de`. Locales are public only when listed in `i18n.policy`.
- **Translation:** "translate" job preset. Only text goes to the model; block structure, CTAs,
  citations, prices and URLs are copied from the source. German SEO and slug, a German OG image, and
  translation QA gates (citations, CTAs, links, prices) on the normal scorecard. Re-translation
  touches only sections whose source changed and keeps editor edits elsewhere. Auto-translate on
  publish plus a `translation-dispatch` back-fill cron. CMS `/translations` coverage matrix,
  catalogue (category/product) translations, a panel on each article. Live check: ~$0.16 per
  24-block slice of a review; a full review costs roughly $0.10–0.40.
- **Newsletter digest (FR-WEB-9):** weekly issue per locale from new and refreshed articles plus
  deals. HTML + text email, disclosure (German "Werbehinweis"), RFC 8058 one-click unsubscribe.
  Resend batch sends with one delivery row per subscriber, so repeats never double-email. Hourly
  `newsletter-digest` task (auto-send or draft + notification). CMS `/newsletter` for preview,
  editing, test send and scheduling.
- **Search Console (FR-MNT-3):** service-account adapter in `@repo/ai`; daily import of
  page×day and top queries (`search-console-import`, before the refresh scheduler) plus backfill up
  to 16 months. Decay detection compares two windows (click drop, position loss) and flags articles
  with a weekly de-duplicated notification. Flagged products' refresh is pulled forward. CMS `/decay`
  list and a Search Console panel on the article page.
- **A/B offers (FR-AFF-13):** experiments over 2+ links of one product. Variant clicks carry a
  `--v<token>` SubID segment, so imported conversions attribute to `conversions.link_id`. Per-variant
  report: clicks, conversion rate, commission, EPC, traffic share. Two-proportion and Welch tests
  against the leader, with a minimum-clicks gate. Promote winner (losers paused). The UI is on the
  product's Affiliate tab and an "A/B tests" tab.
- **Hands-on trials (FR-RES-7):** AES-256-GCM vault (`VAULT_KEY`, rotation by key version). A
  browser agent loop over a `BrowserDriver` interface (Playwright in the worker; remote CDP or local
  Chromium) with secrets passed as placeholders only. Email verification goes through Resend
  receiving. Hard guardrails: own domain only; stop on payment, CAPTCHA, phone verification or
  third-party sign-in; step/cost/time caps. Session notes become a first-party source that the fact
  sheet and writer cite. Runs inside full reviews of opted-in products (on a `medium-1x` machine)
  or standalone from CMS `/hands-on`; `/vault` is admin-only and write-only. Live check against a
  local fixture site: $0.095, 14 steps.

Deviations and decisions:

- German URLs keep English segments (`/de/reviews/<german-slug>`); German slugs transliterate
  umlauts and ß.
- Products and fact sheets are shared across locales; only articles are per locale. Category names
  and product taglines live in `translations` jsonb with English fallback. Deal titles, author bios
  and the CMS AI-disclosure setting stay English (German pages use a fixed catalogue line).
- The A/B winner is called on EPC, not conversion rate, because variants from different programs pay
  differently. Links whose program forbids redirects cannot be variants (they bypass `/go`).
- The hands-on agent uses the existing structured-output LLM wrapper (one action per turn) instead of
  the tool-use API, so cost tracking and refusal handling stay in one place.
- Network "new programs" directories are still not crawled (unchanged from Phase 2).

---

## 10. Risks and mitigations

| Risk                                                      | Impact                   | Mitigation                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google classifies the site as scaled/low-value AI content | Traffic collapse         | Original evidence, citations, human approval, named editor, cadence cap, refresh cadence, narrow niche start, no fabricated ratings; monitor Search Console from month 1.                                                                                                             |
| Affiliate approvals slow or denied for a new site         | No commission early      | Vendor-URL/UTM fallback day one; catch-all network; prioritise products with open programs (PartnerStack/Rewardful/Lemon Squeezy style) when choosing the first 50 reviews; the sourcing queue (FR-INT-7) ranks by commission so the new-releases track targets high-paying programs. |
| Hallucinated pricing/features                             | Trust and legal exposure | Structured extraction with citations, fact-check gate blocks publish, "verified on" dates, report-a-change loop.                                                                                                                                                                      |
| Scraping blocked / ToS friction                           | Thin research            | Firecrawl with fallbacks, official sources prioritised, robots respected, cache sources.                                                                                                                                                                                              |
| Cost creep per article                                    | Margin                   | Ledger per step, cost ceilings, Haiku for bulk, caching, Batches for refresh, alerts at 2× target.                                                                                                                                                                                    |
| Vendor lock-in (Trigger.dev, Firecrawl, model provider)   | Rewrite cost             | Adapters and pure-function steps; keep BullMQ and Playwright as documented exit paths.                                                                                                                                                                                                |
| Single operator bottleneck in review                      | Throughput               | Section-level regenerate, keyboard-driven queue, auto-publish for low-risk categories after track record.                                                                                                                                                                             |
| Legal: FTC/trademark/copyright/GDPR                       | Fines, takedowns         | Disclosure enforced in renderer, nominative logo use with notice, short quotes only, cookieless clicks + consent banner, DMCA contact.                                                                                                                                                |

---

## 11. Immediate next steps (what gets built first, in order)

1. Scaffold apps and packages per §2; wire Turborepo tasks and CI (read the installed Turborepo docs first, per `AGENTS.md`).
2. `packages/db`: schema + migrations for SRS §6; `packages/core` with product/article/affiliate services.
3. `packages/affiliate`: link builder + resolver with full tests; `/go/[slug]` route in `apps/web` with click queue.
4. `packages/ai`: LLM wrapper (usage ledger, caching, effort, refusal handling) and Firecrawl adapter.
5. `packages/pipeline`: `resolve_product`, `crawl_official`, `collect_third_party`, `chunk_embed`, `extract_facts`, `fact_sheet` + Trigger.dev task in `apps/worker`.
6. `apps/cms`: auth, intake form, job detail with step status and costs, fact-sheet viewer.
7. `packages/pipeline`: `seo_brief`, `write`, `fact_check`, `style_pass`, `graphics`, `qa_gates`.
8. `apps/cms`: review queue + block editor; `apps/web`: review page with blocks, structured data, CTAs, ISR; publish flow.
9. `apps/api`: v1 read endpoints + OpenAPI + client generation.
10. Run the SRS §8 acceptance checklist on 5 real products; fix; then Phase 2.

Environment variables expected (names only): `DATABASE_URL`, `UPSTASH_REDIS_REST_URL/TOKEN`, `R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET`, `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `VOYAGE_API_KEY`, `TRIGGER_SECRET_KEY`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `SENTRY_DSN`, `PLAUSIBLE_DOMAIN`, `REVALIDATE_SECRET`, `INDEXNOW_KEY`; phase 2 adds TTS, image, YouTube and network credentials.
