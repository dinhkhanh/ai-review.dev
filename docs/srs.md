# AI Review — Software Requirements Specification (SRS)

| Field         | Value                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| Project       | ai-review.dev — AI-generated reviews of SaaS and digital products, monetised through affiliate commissions |
| Version       | 0.1 (draft for owner approval)                                                                             |
| Date          | 2026-10-10                                                                                                 |
| Owner         | Site operator (single admin)                                                                               |
| Companion doc | `docs/plan.md` (architecture, stack decisions, roadmap)                                                    |

---

## 1. Introduction

### 1.1 Purpose

This document specifies what the AI Review platform must do. It is the contract between the owner and the implementation (built mostly by AI coding agents inside this monorepo). Every requirement has an ID so it can be referenced from issues, PRs and tests.

### 1.2 Scope

The platform consists of:

1. **Public website** (`apps/web`) — SEO-optimised review, comparison and "best of" pages for SaaS and digital products, with affiliate calls-to-action.
2. **Admin CMS** (`apps/cms`) — where the admin submits a product name or URL, monitors the AI pipeline, reviews and approves content, and manages affiliate programs, links and revenue.
3. **AI content pipeline** (`apps/worker` + `packages/pipeline`) — research, source collection, fact sheet, article writing, image design, video production, SEO packaging and quality gates.
4. **Affiliate engine** (`packages/affiliate` + redirect endpoint) — affiliate program discovery, link generation, cloaked redirect (`/go/:slug`), click tracking, conversion/revenue import, link health.
5. **Public API** (`apps/api`) — versioned REST API with an OpenAPI spec, consumed by the web app for client-side features and by the future mobile app (`apps/mobile`, phase 3).

Launch focus (decision D-2): AI tools, marketing, developer tools, hosting/servers, productivity, and a "new releases" track for recently launched tools with high-commission programs. The platform itself is category-agnostic.

Out of scope for v1: user accounts for visitors, user-submitted reviews, paid listings/sponsorships, multi-tenant operation, multiple languages (schema is i18n-ready, UI is English-only).

### 1.3 Definitions

| Term              | Meaning                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Product           | A SaaS or digital product being reviewed (e.g. Notion, Jasper, a Gumroad course).                                                  |
| Review job        | One run of the pipeline for one product, from intake to publish-ready.                                                             |
| Step              | A single pipeline stage (research, write, image, …) with persisted input/output and its own retry policy.                          |
| Fact sheet        | Structured, cited facts about a product (pricing tiers, features, platforms, integrations, company, ratings) produced by research. |
| Article           | The long-form review. Stored as structured content blocks, not raw HTML, so web and mobile can both render it.                     |
| Affiliate program | The commercial arrangement with a vendor or network (commission %, cookie window, terms, tracking format).                         |
| Affiliate link    | A concrete outbound URL for a product + offer + region, with a status (pending, active, paused, broken).                           |
| Go-link           | Our redirect URL `https://ai-review.dev/go/<slug>` used in all CTAs; resolves to the current best affiliate link.                  |
| SubID             | A tracking parameter we append (article slug + placement) so network reports can be attributed to a page.                          |
| Quality gate      | An automated or human check that must pass before an article can be published.                                                     |

### 1.4 References

- FTC Endorsement Guides (16 CFR Part 255) — disclosure of material connections.
- Google Search Essentials: spam policies (scaled content abuse, site reputation abuse), "Write high quality reviews" guidance.
- schema.org `Product`, `Review`, `AggregateRating`, `FAQPage`, `ItemList`, `VideoObject`.
- Individual affiliate network terms (PartnerStack, Impact, Awin/ShareASale, CJ, Rewardful, FirstPromoter, Tolt, Lemon Squeezy, Skimlinks/Sovrn, Amazon Associates).
- YouTube Data API v3 and YouTube disclosure rules for altered/synthetic content.

---

## 2. Overall Description

### 2.1 Product perspective

A content business, not just a website. The pipeline is the product: the admin types a URL and the system produces a publish-ready, fact-checked, illustrated review with a monetised CTA within hours and keeps it fresh afterwards. Revenue = clicks × conversion rate × commission, so the affiliate engine and SEO performance are first-class requirements, not afterthoughts.

### 2.2 User classes

| Class                     | Description                                                                                             | Needs                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Admin (owner)             | Single operator today. Submits products, approves content, manages affiliate accounts, watches revenue. | Minimal clicks per review, clear pipeline status, cost visibility, one-click re-runs.   |
| Editor (phase 2)          | Optional human editor with no settings access.                                                          | Edit/approve queue only.                                                                |
| Visitor                   | Searcher arriving from Google/YouTube/social, usually on mobile, comparing tools before buying.         | Fast pages, clear verdict, honest pros/cons, pricing, alternatives, obvious disclosure. |
| Mobile app user (phase 3) | Same as visitor plus saved items, alerts.                                                               | Stable API, structured content, push notifications.                                     |
| Search engines / crawlers | Google, Bing, LLM crawlers.                                                                             | Clean HTML, structured data, sitemaps, fast TTFB.                                       |
| Affiliate networks        | External systems that receive clicks and report conversions.                                            | Correct tracking parameters, compliant link usage, reports import.                      |

### 2.3 Operating environment

- TypeScript monorepo (pnpm 11, Turborepo 2.11, Node ≥ 24).
- Next.js apps deployed on Vercel; long-running worker on a durable task runner (see plan §3); Postgres with pgvector; object storage for media; Redis for cache/rate limiting.
- AI providers accessed through adapters: LLM (Anthropic Claude), web search/scrape (Firecrawl), embeddings, image generation, text-to-speech, video rendering (Remotion).

### 2.4 Design and implementation constraints

- **C-1** All content must be renderable on web (HTML) and natively on mobile: articles are stored as structured blocks (portable JSON), never as opaque HTML.
- **C-2** All outbound monetised links go through the go-link redirect, except for programs whose terms forbid redirects/cloaking (per-program flag; e.g. Amazon Associates). Those render the raw tracked URL.
- **C-3** Every pipeline step is idempotent and resumable; output is persisted before the next step starts.
- **C-4** Every LLM/API call records tokens and cost to a ledger keyed by job and step.
- **C-5** Prompts are versioned artefacts in the repo; the version used is recorded on each generated artefact.
- **C-6** No pipeline step may publish to the public site without passing the quality gates; human approval is required by default (auto-publish is an explicit opt-in per category with a score threshold).
- **C-7** Scraping respects `robots.txt` and rate limits; copyrighted third-party text is stored for citation and summarisation, never republished verbatim beyond short quotes.
- **C-8** Secrets live in environment variables / the hosting provider's secret store, never in the repo.

### 2.5 Assumptions and dependencies

- The admin holds (or will apply for) affiliate accounts; the system can discover programs and track applications but cannot complete most sign-ups automatically.
- Google's quality guidance favours first-hand experience; the pipeline must therefore collect original evidence (screenshots, pricing snapshots, feature matrices) and the admin accepts a human review step for quality and compliance.
- AI provider pricing and model IDs change; the adapter layer isolates this.

---

## 3. Functional Requirements

Priority: **M** = must have for MVP (phase 1), **S** = should have (phase 2), **C** = could have (phase 3+).

### 3.1 Intake (FR-INT)

| ID       | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pri                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| FR-INT-1 | Admin can submit a product by **name**, **URL**, or both, optionally with category, target keywords, review angle (e.g. "for freelancers"), competitors to compare against, and a language (default `en`).                                                                                                                                                                                                                                                                                                                                      | M                            |
| FR-INT-2 | Admin can bulk-submit via CSV or pasted list (one product per line). Each becomes a separate job.                                                                                                                                                                                                                                                                                                                                                                                                                                               | S                            |
| FR-INT-3 | The system resolves the canonical product: official domain, name, tagline, logo, pricing URL, docs/changelog URLs, app-store listings, social handles. Ambiguity (several candidates) is shown to the admin for a one-click choice.                                                                                                                                                                                                                                                                                                             | M                            |
| FR-INT-4 | Duplicate detection: if the product already exists, the admin is offered "refresh existing review" instead of creating a duplicate.                                                                                                                                                                                                                                                                                                                                                                                                             | M                            |
| FR-INT-5 | Admin can choose job presets: _Full review_, _Quick review (no video)_, _Comparison (A vs B)_, _Alternatives list_, _Best-of list for a category_, _Refresh only_.                                                                                                                                                                                                                                                                                                                                                                              | M (full, quick) / S (others) |
| FR-INT-6 | Admin can set a per-job cost ceiling; the job pauses for approval when the ledger exceeds it.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | S                            |
| FR-INT-7 | **Product sourcing**: a scheduled discovery task proposes products to review, ranked by expected value. Signals: new launches (Product Hunt, Hacker News "Launch", app marketplaces, network "new programs" directories), affiliate availability and commission rate (recurring % and cookie window weighted highest), search demand for "<name> review" / "<name> pricing", and fit with the launch categories (D-2). Proposals appear in a CMS "Suggested products" queue with the evidence; admin accepts one click into a job or dismisses. | S                            |

### 3.2 Research and source collection (FR-RES)

| ID       | Requirement                                                                                                                                                                                                                                                                                                                                                     | Pri |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-RES-1 | Crawl the official site (home, pricing, features, FAQ, docs index, changelog, terms) and store each page as a **source** with URL, fetch time, raw markdown, and screenshot.                                                                                                                                                                                    | M   |
| FR-RES-2 | Collect third-party sources: review aggregators (G2, Capterra, Trustpilot, Product Hunt), community (Reddit, Hacker News), video (YouTube transcripts), news/blog mentions, status/uptime pages where available. Each stored as a source with provenance.                                                                                                       | M   |
| FR-RES-3 | Chunk and embed all sources for retrieval; every later generation step cites sources by ID.                                                                                                                                                                                                                                                                     | M   |
| FR-RES-4 | Produce a **fact sheet** via structured output: pricing tiers (price, billing period, limits, trial, money-back), feature list, platforms, integrations, security/compliance claims, company info, founding year, funding, ratings from aggregators (value, count, date), support channels, notable limitations. Each field carries citations and a confidence. | M   |
| FR-RES-5 | Identify 3–8 competitors/alternatives with a one-line positioning for each (used for comparison tables and internal links).                                                                                                                                                                                                                                     | M   |
| FR-RES-6 | Capture original evidence: screenshots of public pages (home, pricing, feature pages) at desktop and mobile widths, stored as media assets with timestamp.                                                                                                                                                                                                      | M   |
| FR-RES-7 | Hands-on evidence (phase 2): a browser agent signs up for a free trial using a dedicated test identity, captures in-app screenshots and notes. Guarded by a per-product opt-in and a credential vault.                                                                                                                                                          | C   |
| FR-RES-8 | Research outputs are visible in the CMS (sources list, fact sheet editor) and editable before writing begins.                                                                                                                                                                                                                                                   | M   |
| FR-RES-9 | Re-running research diffs the new fact sheet against the previous one and lists changes (e.g. price change) to drive refreshes.                                                                                                                                                                                                                                 | S   |

### 3.3 Affiliate program discovery and link management (FR-AFF)

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pri                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| FR-AFF-1  | For every product, the pipeline searches for an affiliate/partner/referral program: vendor pages (`/affiliates`, `/partners`, `/referral`), known networks (PartnerStack, Impact, Awin, ShareASale, CJ, Rewardful, FirstPromoter, Tolt, Lemon Squeezy, Gumroad, AppSumo, Paddle), and search results. It records: program type, network, commission model and rate, cookie duration, payout terms, sign-up URL, approval requirements, link format (ref param, deep-link API, provided URL only), cloaking/redirect policy. | M                                |
| FR-AFF-2  | A program has a lifecycle: `not_found → found → applied → approved → active → paused/rejected/terminated`. The admin updates status manually; the CMS shows a queue of programs to apply to, with sign-up URLs and a draft application message.                                                                                                                                                                                                                                                                             | M                                |
| FR-AFF-3  | Admin can store one or more **affiliate links** per product with: offer label, destination URL, region (default global), network, tracking parameter template, status, priority, start/end dates, notes.                                                                                                                                                                                                                                                                                                                    | M                                |
| FR-AFF-4  | Link generation: for networks with deep-link APIs or a documented parameter scheme (e.g. `?via=`, `?ref=`, `?fpr=`, PartnerStack `pscd`, Impact tracking links), the system builds the link from the stored template; for manual programs the admin pastes the URL.                                                                                                                                                                                                                                                         | M (templates) / S (network APIs) |
| FR-AFF-5  | Fallback monetisation: when no direct program exists, the system can use a catch-all network (Skimlinks/Sovrn) if enabled, or fall back to the plain vendor URL with UTM parameters. The CTA still works on day one.                                                                                                                                                                                                                                                                                                        | S                                |
| FR-AFF-6  | **Go-link redirect**: `GET /go/:slug[?p=placement]` returns a 302 to the active highest-priority link for the visitor's region, appending the SubID (article slug, placement) in the network's format. Target p95 latency ≤ 100 ms. Unknown slug → 404 page with search. Paused/broken links fall through to the next priority, then to the vendor URL.                                                                                                                                                                     | M                                |
| FR-AFF-7  | Click logging (asynchronous, never delays the redirect): timestamp, go-slug, resolved link ID, referring page path, placement, device class, country, hashed IP, user-agent hash, bot flag. No cookies are required for logging.                                                                                                                                                                                                                                                                                            | M                                |
| FR-AFF-8  | Auto-swap: when a program moves to `active` and a link is added, every CTA on the site uses it immediately because CTAs reference the go-slug, not the URL. Published pages revalidate within 60 s.                                                                                                                                                                                                                                                                                                                         | M                                |
| FR-AFF-9  | Per-program **redirect policy** flag: `allowed`, `forbidden` (render tracked URL directly, e.g. Amazon), `unknown` (treated as allowed with a warning).                                                                                                                                                                                                                                                                                                                                                                     | M                                |
| FR-AFF-10 | Link health: scheduled check (daily) follows each affiliate link to the final destination and flags 4xx/5xx, redirect loops, landing-page domain changes, or missing tracking parameter on the final page. Broken links are auto-paused and the admin is notified.                                                                                                                                                                                                                                                          | S                                |
| FR-AFF-11 | Conversion import: CSV upload mapped to a common schema (date, network, program, SubID, order ID, amount, commission, status). API connectors for networks that expose reporting APIs (Impact, PartnerStack, Awin) in phase 2.                                                                                                                                                                                                                                                                                              | S                                |
| FR-AFF-12 | Revenue attribution: commissions joined to clicks by SubID → revenue per article, per product, per placement, per month; EPC (earnings per click) and conversion rate dashboards.                                                                                                                                                                                                                                                                                                                                           | S                                |
| FR-AFF-13 | A/B offers: two active links with weights for the same slug; the redirect splits traffic and reports EPC per variant.                                                                                                                                                                                                                                                                                                                                                                                                       | C                                |
| FR-AFF-14 | Disclosure: every page containing a go-link renders the affiliate disclosure above the fold and links to the full policy page; all monetised anchors carry `rel="sponsored nofollow noopener"`. Enforced by the renderer, not by the author.                                                                                                                                                                                                                                                                                | M                                |

### 3.4 Content generation (FR-CON)

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                 | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-CON-1  | SEO brief: from the fact sheet and a SERP/keyword analysis, produce target primary keyword, secondary keywords, search intent, title candidates, slug, meta description, outline (H2/H3), FAQ questions, and internal-link targets (existing articles).                                                                                     | M   |
| FR-CON-2  | Article generation produces a structured document with a fixed section contract: TL;DR verdict with score, "who it's for / not for", key features, pricing analysis (with our pricing table), pros and cons, hands-on notes/evidence, alternatives and comparison table, FAQ, final verdict and CTA. Sections are individually regenerable. | M   |
| FR-CON-3  | Scoring rubric: 5–7 weighted dimensions (e.g. features, ease of use, value, support, integrations, security) each 1–10 with a one-sentence justification and citations; overall score computed, not free-typed. Rubric is configurable per category.                                                                                        | M   |
| FR-CON-4  | Every factual claim (prices, limits, ratings, dates) in the article references a source ID; the renderer can show footnotes/"sources" section. Claims without a source are flagged by the fact-check step.                                                                                                                                  | M   |
| FR-CON-5  | Fact-check pass: a separate model call compares each claim to its cited source text and marks `supported / unsupported / outdated`; unsupported claims block publication until fixed or removed.                                                                                                                                            | M   |
| FR-CON-6  | Style pass: enforce the house style guide (tone, reading level, banned phrases, no filler, first-person plural editorial voice), length targets per preset, and remove AI clichés.                                                                                                                                                          | M   |
| FR-CON-7  | Originality check against stored sources (n-gram overlap) and optionally an external plagiarism API; overlap above threshold blocks publication.                                                                                                                                                                                            | S   |
| FR-CON-8  | Generate derivative content from the same fact sheet: comparison articles (A vs B), alternatives lists, best-of lists, and short social snippets (X/LinkedIn/Threads) with the go-link.                                                                                                                                                     | S   |
| FR-CON-9  | Structured data: `Product` + `Review` + `AggregateRating` (our rating only; never fabricate user counts), `FAQPage`, `BreadcrumbList`, `VideoObject` when a video exists, `Organization`/`Person` author. Validated before publish.                                                                                                         | M   |
| FR-CON-10 | AI disclosure: each article shows "Researched with AI, reviewed by a human editor" (text configurable) and the last-verified date.                                                                                                                                                                                                          | M   |
| FR-CON-11 | Version history: each regeneration or manual edit creates a new article version; the admin can diff and roll back.                                                                                                                                                                                                                          | M   |

### 3.5 Visual assets (FR-MED)

| ID       | Requirement                                                                                                                                                                                                                                    | Pri |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-MED-1 | Templated graphics rendered deterministically from data (no generative model): hero/OG image with product name and score, pricing table card, pros/cons card, comparison table card, "score badge". Brand-consistent via shared design tokens. | M   |
| FR-MED-2 | Generative images via an image-model adapter for illustrative hero/section images, with a prompt derived from the article; must not reproduce the vendor's logo or trademarked UI.                                                             | S   |
| FR-MED-3 | Screenshot processing: crop, device frame, annotate (arrows/labels) from research screenshots; store original and processed versions.                                                                                                          | S   |
| FR-MED-4 | All images stored in object storage with multiple sizes (thumb/card/full), AVIF/WebP, alt text generated and editable, and recorded as media assets linked to the article.                                                                     | M   |
| FR-MED-5 | Logo handling: product logos are fetched from the vendor's site/favicon and used only in identification contexts (cards, comparison tables) with a trademark notice on the policy page.                                                        | M   |

### 3.6 Video (FR-VID)

| ID       | Requirement                                                                                                                                                                                                                                                            | Pri |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-VID-1 | Script generation from the approved article: 60–120 s short (9:16) and 4–8 min long-form (16:9) scripts with scene list, on-screen text, and the assets each scene uses.                                                                                               | S   |
| FR-VID-2 | Voice-over via a TTS adapter with word-level timestamps for captions; voice is configurable per channel.                                                                                                                                                               | S   |
| FR-VID-3 | Rendering via programmatic compositions (screenshots, score reveals, pricing tables, captions, background music, outro with go-link URL/QR). Output MP4 (H.264) in both aspect ratios plus thumbnail candidates.                                                       | S   |
| FR-VID-4 | Publishing: upload to YouTube via API with title, description (including disclosure and the go-link), tags, chapters, and the "altered or synthetic content" flag set; store the video ID and embed on the article page. Optional manual download for other platforms. | S   |
| FR-VID-5 | Admin can preview the video and regenerate the script, voice, or render individually.                                                                                                                                                                                  | S   |

### 3.7 Quality gates and approval (FR-QA)

| ID      | Requirement                                                                                                                                                                                                                                                                                                            | Pri |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-QA-1 | Automated gate results per article: fact-check pass rate, unsupported-claim count, originality score, readability grade, SEO checklist (title length, meta, headings, internal links, image alt), structured-data validation, disclosure present, go-link present, broken link count. Shown as a scorecard in the CMS. | M   |
| FR-QA-2 | A review state machine: `draft → in_review → changes_requested → approved → scheduled → published → archived`. Only `approved`/`scheduled` can be published.                                                                                                                                                           | M   |
| FR-QA-3 | Human review UI: side-by-side article preview and source evidence; inline comment; "regenerate this section with instruction"; accept/reject per section.                                                                                                                                                              | M   |
| FR-QA-4 | Auto-publish option per category: if all hard gates pass and the soft score ≥ threshold, publish without human review. Off by default.                                                                                                                                                                                 | S   |
| FR-QA-5 | Compliance checklist auto-filled: disclosure, `rel=sponsored`, no fabricated user ratings, no verbatim copying, trademarks used nominatively, AI disclosure present.                                                                                                                                                   | M   |

### 3.8 Publishing and public website (FR-WEB)

| ID        | Requirement                                                                                                                                                                                                                                                                   | Pri                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| FR-WEB-1  | Page types: home, category hub, review (`/reviews/:slug`), comparison (`/compare/:a-vs-:b`), alternatives (`/alternatives/:slug`), best-of (`/best/:category`), deals (`/deals`), search, about, editorial policy, affiliate disclosure, privacy, contact, author pages, 404. | M (home, category, review, policies) / S (others) |
| FR-WEB-2  | Rendering: static generation with incremental revalidation; publish or edit triggers revalidation of the page, its category, home, sitemap and RSS within 60 s.                                                                                                               | M                                                 |
| FR-WEB-3  | Core Web Vitals targets on mobile: LCP ≤ 2.0 s, INP ≤ 200 ms, CLS ≤ 0.05 at p75; Lighthouse performance ≥ 90 on review pages.                                                                                                                                                 | M                                                 |
| FR-WEB-4  | SEO plumbing: canonical URLs, Open Graph/Twitter cards from the generated OG image, XML sitemaps (split by type), RSS/Atom, `robots.txt`, IndexNow ping on publish, hreflang-ready routing.                                                                                   | M                                                 |
| FR-WEB-5  | CTA system: sticky bottom CTA on mobile, inline CTAs after verdict and pricing, comparison-table CTAs; each has a distinct placement code passed to the go-link.                                                                                                              | M                                                 |
| FR-WEB-6  | Pricing display shows "verified on <date>" and a "report a change" link that creates a refresh task.                                                                                                                                                                          | M                                                 |
| FR-WEB-7  | Search: full-text search across products and articles with category filters; p95 ≤ 300 ms.                                                                                                                                                                                    | S                                                 |
| FR-WEB-8  | Deals/coupons section fed by the affiliate program data (promo codes, trials).                                                                                                                                                                                                | S                                                 |
| FR-WEB-9  | Newsletter signup (double opt-in) and weekly digest generated from new/updated reviews.                                                                                                                                                                                       | C                                                 |
| FR-WEB-10 | Visitor interactions without accounts: "Was this helpful?" vote, "report an error" form (creates a CMS task), share buttons.                                                                                                                                                  | S                                                 |
| FR-WEB-11 | Consent: analytics and any marketing scripts gated by a consent banner where required by law (EU); click logging stays cookieless and runs without consent.                                                                                                                   | M                                                 |
| FR-WEB-12 | Accessibility: WCAG 2.1 AA for the public site (keyboard navigation, contrast, alt text, focus states).                                                                                                                                                                       | M                                                 |

### 3.9 Admin CMS (FR-CMS)

| ID       | Requirement                                                                                                                                                                                                             | Pri                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| FR-CMS-1 | Authentication: email + password with mandatory 2FA (TOTP or passkey); session timeout; audit log of admin actions. Roles: `admin`, `editor`.                                                                           | M                                 |
| FR-CMS-2 | Dashboard: jobs in progress with step status, items awaiting review, failed steps, today's clicks, 30-day revenue, spend on AI/APIs this month.                                                                         | M                                 |
| FR-CMS-3 | Job detail: timeline of steps with status, duration, cost, logs, inputs/outputs; actions: retry step, re-run from step, cancel, change model/effort for a step and re-run.                                              | M                                 |
| FR-CMS-4 | Product record: identity, fact sheet editor, sources, media, affiliate programs and links, articles, refresh schedule.                                                                                                  | M                                 |
| FR-CMS-5 | Article editor: block-based editor over the structured content, section regenerate, version history/diff, preview on web layout (desktop/mobile), SEO panel, QA scorecard, publish/schedule.                            | M                                 |
| FR-CMS-6 | Affiliate workspace: programs to apply to (queue), active links, link health, click and revenue reports, conversion import, SubID lookup.                                                                               | M (programs, links) / S (reports) |
| FR-CMS-7 | Settings: prompt templates (versioned, editable with test-run), style guide, rubric per category, model/effort per step, cost ceilings, auto-publish rules, categories/taxonomy, authors, integrations/API keys status. | M                                 |
| FR-CMS-8 | Notifications: email (and optional Slack/Telegram webhook) on job completed, step failed, article awaiting review, link broken, program status reminder.                                                                | S                                 |
| FR-CMS-9 | Media library with search, alt text editing, usage ("used in 3 articles").                                                                                                                                              | S                                 |

### 3.10 Public API and mobile readiness (FR-API)

| ID       | Requirement                                                                                                                                                                                                                               | Pri |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-API-1 | Versioned REST API (`/v1`) described by an OpenAPI 3.1 document generated from the code schemas; a typed TypeScript client is generated into a shared package.                                                                            | M   |
| FR-API-2 | Read endpoints: list/search products and articles, article by slug (structured blocks + media + rating + go-link slugs), categories, comparisons, best-of lists, deals. Cached at the edge with cache tags matching the web revalidation. | M   |
| FR-API-3 | Write endpoints for visitors: helpful vote, error report, newsletter subscribe (rate-limited, Turnstile-protected).                                                                                                                       | S   |
| FR-API-4 | Mobile-specific (phase 3): anonymous device registration for push, saved items, price-change alerts, deep links (`aireview://reviews/<slug>` and universal links).                                                                        | C   |
| FR-API-5 | Admin endpoints are a separate, authenticated surface (session or API key) used by the CMS, never exposed to the public spec.                                                                                                             | M   |

### 3.11 Maintenance and freshness (FR-MNT)

| ID       | Requirement                                                                                                                                                                                                                                 | Pri |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-MNT-1 | Each product has a refresh schedule (default every 60 days; 14 days for top-traffic pages). Refresh re-runs research, diffs the fact sheet, and if material changes exist, regenerates affected sections and queues the article for review. | S   |
| FR-MNT-2 | Pricing-change detection updates the pricing table and the "last verified" date automatically after approval.                                                                                                                               | S   |
| FR-MNT-3 | Content decay signals: imported Search Console clicks/impressions per page drive a "needs refresh" list.                                                                                                                                    | C   |
| FR-MNT-4 | Dead product handling: if the vendor site is gone or acquired, the article gets a banner and alternatives are promoted; affiliate links are paused.                                                                                         | S   |

### 3.12 Analytics and revenue (FR-ANL)

| ID       | Requirement                                                                                                                    | Pri                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| FR-ANL-1 | Page analytics via a privacy-friendly provider (page views, referrers, countries) plus our own click events.                   | M                           |
| FR-ANL-2 | Funnel per article: views → CTA clicks → conversions → commission, with CTR per placement.                                     | S                           |
| FR-ANL-3 | Cost analytics: AI/API spend per job, per step, per model; cost per published article; margin per article once revenue exists. | M (ledger) / S (dashboards) |
| FR-ANL-4 | Export: CSV of clicks, conversions and costs by date range.                                                                    | S                           |

---

## 4. External Interface Requirements

### 4.1 User interfaces

- **Public site**: mobile-first, system light/dark theme, max content width ~720 px for reading, sticky mobile CTA, table components that collapse to cards on small screens.
- **CMS**: desktop-first dense UI; keyboard shortcuts for review queue (approve, request changes, next); dark mode.

### 4.2 Software interfaces (adapters)

| Capability         | Interface contract                                          | Initial provider                                                  |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| LLM                | `generate(structured                                        | text, {model, effort, tools})`, streaming, token usage returned   | Anthropic Claude (Opus 5.5 default; Haiku 5.5 for extraction; Sonnet 5.5 mid-tier) |
| Web search         | `search(query, {limit, domains}) → results`                 | Firecrawl search (Claude server-side web search as complement)    |
| Scrape             | `scrape(url, {formats: markdown, screenshot, links})`       | Firecrawl scrape; Playwright in worker for authenticated/hands-on |
| Embeddings         | `embed(texts[]) → vectors`                                  | Provider adapter (Voyage AI recommended)                          |
| Image generation   | `generateImage(prompt, {size, style}) → asset`              | Provider adapter (decided in phase 2)                             |
| Templated graphics | `render(template, data) → PNG/SVG`                          | Satori + resvg (in-process)                                       |
| TTS                | `speak(script, {voice}) → audio + word timestamps`          | Provider adapter (ElevenLabs or OpenAI TTS)                       |
| Video              | `render(composition, props) → MP4`                          | Remotion (worker or Remotion Lambda)                              |
| Video hosting      | `upload(video, metadata) → id`                              | YouTube Data API v3                                               |
| Affiliate networks | `discover`, `buildLink`, `importConversions`, `checkHealth` | Per-network modules; manual URL fallback                          |
| Storage            | `put/get/signedUrl`                                         | Cloudflare R2 (S3 API)                                            |
| Queue/scheduler    | durable tasks, retries, cron                                | See plan §3                                                       |
| Email              | transactional email                                         | Resend or Postmark                                                |
| Analytics          | pageview script + server events                             | Plausible or PostHog                                              |
| Search Console     | import performance by page                                  | Google Search Console API (phase 3)                               |

### 4.3 Communication interfaces

HTTPS only; HSTS; API uses JSON; webhooks from the task runner and networks are signature-verified.

---

## 5. Non-Functional Requirements

| ID     | Category               | Requirement                                                                                                                                                                                                                                                                                          |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-1  | Performance (web)      | See FR-WEB-3. TTFB for cached pages ≤ 200 ms p75 globally.                                                                                                                                                                                                                                           |
| NFR-2  | Performance (redirect) | Go-link p95 ≤ 100 ms; served from edge cache of the link table; DB only on cache miss.                                                                                                                                                                                                               |
| NFR-3  | Throughput             | Pipeline supports ≥ 20 concurrent jobs and ≥ 50 published articles/day without manual intervention (quality gates aside).                                                                                                                                                                            |
| NFR-4  | Reliability            | Steps retry with exponential backoff (max 3); jobs resume from the last completed step after worker restarts; no step can run twice for the same (job, step, attempt) key.                                                                                                                           |
| NFR-5  | Availability           | Public site ≥ 99.9 % (static pages survive DB/worker outages). CMS and pipeline ≥ 99 %.                                                                                                                                                                                                              |
| NFR-6  | Cost                   | Target ≤ US$5 AI/API cost per full review without video and ≤ US$12 with video (tracked, alert at 2× target). Infra fixed cost ≤ US$150/month at MVP scale.                                                                                                                                          |
| NFR-7  | Security               | OWASP ASVS L1 for CMS; 2FA mandatory; rate limiting on all public write endpoints and on `/go`; CSP; dependency scanning in CI; secrets never logged; SSRF protection on any URL the admin submits (block private ranges).                                                                           |
| NFR-8  | Privacy                | Cookieless click logging with IP hashed using a rotating daily salt; GDPR consent for analytics scripts; data retention: raw clicks 13 months, aggregates indefinitely; privacy policy page.                                                                                                         |
| NFR-9  | Legal/compliance       | FTC disclosure on every monetised page; `rel=sponsored`; respect network terms including redirect bans; AI disclosure; honour robots.txt; DMCA/contact route; trademark notice.                                                                                                                      |
| NFR-10 | SEO integrity          | No fabricated ratings or review counts; one canonical page per product; no doorway pages; publishing cadence capped by a configurable daily limit to avoid "scaled content" patterns.                                                                                                                |
| NFR-11 | Observability          | Structured logs with job/step IDs; error tracking (Sentry) in all apps; step-level traces; cost ledger; uptime check on `/go` and homepage.                                                                                                                                                          |
| NFR-12 | Maintainability        | Shared packages with strict TypeScript; schema validation (Zod) at all boundaries; unit tests for the affiliate link builder and redirect resolver (100 % branch coverage), contract tests for the API, snapshot tests for structured-data output; CI runs lint, types, tests and build on every PR. |
| NFR-13 | Portability (mobile)   | Content blocks, media variants and API are the only contract the mobile app depends on; no web-only HTML in the API.                                                                                                                                                                                 |
| NFR-14 | i18n readiness         | All content tables carry `locale`; slugs are per-locale; UI strings in message catalogues even if only `en` ships.                                                                                                                                                                                   |
| NFR-15 | Accessibility          | WCAG 2.1 AA (public); CMS keyboard-navigable.                                                                                                                                                                                                                                                        |
| NFR-16 | Backups                | Daily Postgres backups with 30-day retention; media bucket versioning.                                                                                                                                                                                                                               |

---

## 6. Data Model (logical)

Core entities and key fields. Full schema lives in `packages/db`.

| Entity                                                                                                       | Key fields                                                                                                                                                                                                  | Notes                                             |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `products`                                                                                                   | id, slug, name, tagline, website_url, logo_asset_id, category_id, status, locale, created/updated                                                                                                           | One per real product.                             |
| `product_sources`                                                                                            | id, product_id, url, kind (official/aggregator/community/video/news), fetched_at, content_md, screenshot_asset_id, http_status, robots_allowed                                                              | Raw evidence.                                     |
| `research_chunks`                                                                                            | id, source_id, ord, text, embedding (vector), token_count                                                                                                                                                   | For retrieval and citation.                       |
| `fact_sheets`                                                                                                | id, product_id, version, data (JSONB, schema-validated), citations (JSONB), created_by_job_id, diff_from_prev                                                                                               | Versioned.                                        |
| `competitors`                                                                                                | product_id, competitor_product_id, relation (alternative/direct), note                                                                                                                                      | Self-relation.                                    |
| `review_jobs`                                                                                                | id, product_id, preset, status, requested_by, cost_ceiling, total_cost, started_at, finished_at, error                                                                                                      | One pipeline run.                                 |
| `job_steps`                                                                                                  | id, job_id, name, attempt, status, input_ref, output_ref, model, effort, prompt_version, tokens_in/out, cost, started_at, finished_at, log_url                                                              | Idempotency key (job_id, name, attempt).          |
| `articles`                                                                                                   | id, product_id, type (review/comparison/alternatives/best_of), slug, locale, title, status, current_version_id, published_at, author_id, canonical_product_ids[]                                            |                                                   |
| `article_versions`                                                                                           | id, article_id, version, blocks (JSONB), seo (JSONB), rubric_scores (JSONB), overall_score, qa_scorecard (JSONB), created_by (job/user), created_at                                                         | Immutable.                                        |
| `media_assets`                                                                                               | id, kind (image/screenshot/graphic/video/audio), storage_key, variants (JSONB), width, height, alt, source (generated/templated/captured/vendor), license_note                                              |                                                   |
| `videos`                                                                                                     | id, article_id, kind (short/long), script (JSONB), audio_asset_id, video_asset_id, thumbnail_asset_id, youtube_id, status                                                                                   |                                                   |
| `affiliate_programs`                                                                                         | id, product_id, network, name, status, commission_model, commission_value, cookie_days, signup_url, dashboard_url, terms_url, link_format (JSONB template), redirect_policy, applied_at, approved_at, notes |                                                   |
| `affiliate_links`                                                                                            | id, product_id, program_id, label, destination_url, region, status, priority, weight, starts_at, ends_at, last_health_check_at, health_status                                                               |                                                   |
| `go_slugs`                                                                                                   | slug, product_id, default_link_id                                                                                                                                                                           | Public slug → product.                            |
| `clicks`                                                                                                     | id, ts, go_slug, link_id, article_id, placement, path, country, device, ip_hash, ua_hash, is_bot                                                                                                            | Partition by month.                               |
| `conversions`                                                                                                | id, network, program_id, subid, article_id (derived), order_id, amount, commission, currency, status, occurred_at, imported_at                                                                              |                                                   |
| `cost_ledger`                                                                                                | id, job_id, step_id, provider, model, units, unit_type (tokens/images/seconds/credits), cost_usd, ts                                                                                                        |                                                   |
| `prompt_templates`                                                                                           | id, key, version, body, model_default, effort_default, active                                                                                                                                               | Versioned in repo; mirrored in DB for the editor. |
| `categories`, `tags`, `authors`, `users`, `audit_log`, `settings`, `error_reports`, `newsletter_subscribers` |                                                                                                                                                                                                             |                                                   |

---

## 7. Pipeline State Machine

```
intake ──▶ resolve_product ──▶ research ──┬──▶ fact_sheet ──▶ seo_brief ──▶ write ──▶ fact_check ──▶ style_pass
                                          │                                                              │
                                          └──▶ affiliate_discovery (parallel)                            ▼
                                                                                                   graphics ──▶ qa_gates ──▶ [human review] ──▶ publish ──▶ (video_script ──▶ tts ──▶ render ──▶ youtube)
```

- Each box is a `job_steps` row. A step reads only persisted outputs of earlier steps.
- Failure in a non-critical branch (affiliate discovery, video) never blocks publishing of the article.
- Any step can be re-run by the admin; downstream steps are marked `stale` and re-run on request.

---

## 8. Acceptance Criteria for MVP (Phase 1)

1. Admin submits `https://example-saas.com` in the CMS and, with no further input, receives within 30 minutes an article in `in_review` with: fact sheet with ≥ 90 % of pricing fields cited; ≥ 8 sources including ≥ 2 third-party; screenshots of home and pricing; rubric scores; OG image and pricing card; QA scorecard with zero unsupported claims after fact-check.
2. Admin approves; the page is live at `/reviews/<slug>` within 60 s with valid structured data (Rich Results Test passes), disclosure, and CTAs pointing at `/go/<slug>`.
3. Before any affiliate program exists, `/go/<slug>` redirects to the vendor URL with UTM; after the admin marks a program active and adds a link, the same URL redirects to the affiliate link with SubID, without redeploying.
4. Clicks appear in the dashboard within 1 minute; a Lighthouse mobile run on the review page scores ≥ 90 performance and ≥ 95 SEO/accessibility.
5. Cost ledger shows total spend for the job; the total is ≤ US$5 for a quick review.
6. Re-running "research" on the same product produces a fact-sheet diff and does not create a duplicate product or article.

---

## 9. Decisions (resolved 2026-10-10)

| #   | Item                                     | Decision                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Brand name and domain                    | `ai-review.dev` (default).                                                                                                                                                                                                                                                                            |
| D-2 | Niche focus at launch                    | All SaaS is in scope. Launch focus categories: **AI tools, marketing, developer tools, hosting/servers, productivity**, plus a rolling **"new releases"** track for recently launched tools whose affiliate programs pay high commissions (see FR-INT-7). Other categories are added once these rank. |
| D-3 | Human review mandatory at launch         | Yes; revisit after 50 published articles (default).                                                                                                                                                                                                                                                   |
| D-4 | Catch-all monetisation (Skimlinks/Sovrn) | Enabled as fallback only (default).                                                                                                                                                                                                                                                                   |
| D-5 | Video timing                             | Phase 2 (default).                                                                                                                                                                                                                                                                                    |
| D-6 | Hands-on trial sign-ups by browser agent | Off until reviewed per vendor (default).                                                                                                                                                                                                                                                              |
| D-7 | Publishing cadence cap                   | 5 articles/day at launch, raised gradually (default).                                                                                                                                                                                                                                                 |
| D-8 | Editorial persona                        | Owner as editor-in-chief with a real author page; AI assistance disclosed (default).                                                                                                                                                                                                                  |

Primary business risk: Google treating the site as scaled AI content. Mitigations are built into the requirements: original evidence (FR-RES-6), citations and fact-checking (FR-CON-4/5), human approval (C-6), cadence cap (NFR-10), real author pages, and refresh/maintenance (FR-MNT). The second risk is affiliate approval latency; the go-link fallback (FR-AFF-5/6) ensures pages monetise or at least convert to vendor traffic from day one.
