import { LAUNCH_CATEGORIES } from "@repo/content";
import { and, articles, categories, eq, inArray, products, sql, users, type DbOrTx } from "@repo/db";
import { countStatuses, type CheckItem, type CheckStatus, type StatusCounts } from "./acceptance";
import { getSetting } from "./settings";

/**
 * Launch readiness (Phase 4): configuration and content checks the owner works through before
 * launch, next to the per-job SRS §8 results. The environment is passed in (the CMS passes its own
 * `process.env`), so only what the CMS deployment sees is checked here; the web, API and worker
 * destinations are covered by `node scripts/prod.mjs env:check`.
 */

export type ReadinessEnv = Record<string, string | undefined>;

export type ReadinessGroup = {
  id: string;
  label: string;
  items: CheckItem[];
};

export type ReadinessReport = { groups: ReadinessGroup[]; summary: StatusCounts };

export type ReadinessOptions = {
  fetch?: typeof fetch;
  /** Public site base URL; defaults to `env.NEXT_PUBLIC_SITE_URL`. */
  siteUrl?: string;
  timeoutMs?: number;
};

/** Integrations the CMS needs at launch (fail when missing). */
export const REQUIRED_CMS_ENV: Array<{ id: string; label: string; vars: string[] }> = [
  { id: "database", label: "Database", vars: ["DATABASE_URL"] },
  { id: "auth", label: "CMS auth secret", vars: ["BETTER_AUTH_SECRET"] },
  { id: "anthropic", label: "Anthropic (Claude)", vars: ["ANTHROPIC_API_KEY"] },
  { id: "firecrawl", label: "Firecrawl", vars: ["FIRECRAWL_API_KEY"] },
  { id: "trigger", label: "Trigger.dev worker dispatch", vars: ["TRIGGER_SECRET_KEY"] },
  { id: "redis", label: "Upstash Redis", vars: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] },
  {
    id: "r2",
    label: "Cloudflare R2 media",
    vars: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "NEXT_PUBLIC_MEDIA_URL"],
  },
  { id: "revalidate", label: "Web revalidation on publish", vars: ["REVALIDATE_SECRET", "NEXT_PUBLIC_SITE_URL"] },
  { id: "cms_url", label: "CMS public URL (links in notifications)", vars: ["NEXT_PUBLIC_CMS_URL"] },
];

/** Recommended at launch (warn when missing). `anyOf` passes when one of the variables is set. */
export const RECOMMENDED_CMS_ENV: Array<{ id: string; label: string; vars: string[]; anyOf?: boolean; why: string }> = [
  {
    id: "sentry",
    label: "Error monitoring (Sentry)",
    vars: ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"],
    anyOf: true,
    why: "CMS errors go unseen without it.",
  },
  {
    id: "email",
    label: "Notification email (Resend)",
    vars: ["RESEND_API_KEY", "NOTIFY_EMAIL_FROM"],
    why: "Job, review and broken-link notifications are email-first.",
  },
  {
    id: "embeddings",
    label: "Voyage embeddings",
    vars: ["VOYAGE_API_KEY"],
    why: "Without it retrieval falls back to full-text search.",
  },
  {
    id: "search_console",
    label: "Search Console",
    vars: ["GSC_CLIENT_EMAIL", "GSC_PRIVATE_KEY", "GSC_SITE_URL"],
    why: "Decay detection (FR-MNT-3) needs it; set it from month 1.",
  },
];

/** D-3 is revisited after this many published articles (SRS §9). */
export const HUMAN_REVIEW_UNTIL_PUBLISHED = 50;
/** D-7 launch cadence cap. */
export const LAUNCH_DAILY_CAP = 5;
/** Phase 4 exit criterion: five real products through the full pipeline. */
export const LAUNCH_MIN_PUBLISHED_REVIEWS = 5;

const has = (env: ReadinessEnv, key: string) => !!env[key]?.trim();

function envItems(env: ReadinessEnv): CheckItem[] {
  const required = REQUIRED_CMS_ENV.map(({ id, label, vars }): CheckItem => {
    const missing = vars.filter((v) => !has(env, v));
    return {
      id: `env.${id}`,
      label,
      status: missing.length ? "fail" : "pass",
      detail: missing.length ? `Missing: ${missing.join(", ")}.` : `Set: ${vars.join(", ")}.`,
      evidence: { missing },
    };
  });
  const recommended = RECOMMENDED_CMS_ENV.map(({ id, label, vars, anyOf, why }): CheckItem => {
    const missing = vars.filter((v) => !has(env, v));
    const ok = anyOf ? missing.length < vars.length : missing.length === 0;
    return {
      id: `env.${id}`,
      label,
      status: ok ? "pass" : "warn",
      detail: ok ? `Set.` : `Missing: ${anyOf ? `one of ${vars.join(" / ")}` : missing.join(", ")}. ${why}`,
      evidence: { missing },
    };
  });
  const channel = ["NOTIFY_WEBHOOK_URL", "TELEGRAM_BOT_TOKEN", "RESEND_API_KEY"].some((v) => has(env, v));
  return [
    ...required,
    ...recommended,
    {
      id: "env.notify_channel",
      label: "At least one notification channel",
      status: channel ? "pass" : "warn",
      detail: channel
        ? "Email, webhook or Telegram is configured."
        : "Set RESEND_API_KEY, NOTIFY_WEBHOOK_URL or TELEGRAM_BOT_TOKEN so failures reach you.",
    },
  ];
}

async function peopleItems(db: DbOrTx): Promise<CheckItem[]> {
  const staff = await db
    .select({ email: users.email, role: users.role, twoFactorEnabled: users.twoFactorEnabled, banned: users.banned })
    .from(users);
  const active = staff.filter((u) => !u.banned && (u.role === "admin" || u.role === "editor" || u.role === null));
  const without = active.filter((u) => !u.twoFactorEnabled).map((u) => u.email);
  const admins = active.filter((u) => u.role === "admin").length;
  return [
    {
      id: "people.admin",
      label: "At least one admin account",
      status: admins > 0 ? "pass" : "fail",
      detail: `${admins} admin${admins === 1 ? "" : "s"}, ${active.length - admins} editor${active.length - admins === 1 ? "" : "s"}.`,
    },
    {
      id: "people.2fa",
      label: "Every admin and editor has 2FA enrolled",
      status: active.length === 0 ? "fail" : without.length ? "fail" : "pass",
      detail:
        active.length === 0
          ? "No CMS accounts."
          : without.length
            ? `Not enrolled: ${without.join(", ")}. They cannot open the CMS until they do (FR-CMS-1).`
            : `${active.length} of ${active.length} enrolled.`,
      evidence: { notEnrolled: without },
    },
  ];
}

async function publishedReviewCount(db: DbOrTx) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(articles)
    .where(and(eq(articles.status, "published"), eq(articles.type, "review"), eq(articles.locale, "en")));
  return Number(row?.n ?? 0);
}

async function settingsItems(db: DbOrTx, env: ReadinessEnv, published: number): Promise<CheckItem[]> {
  const [requireReview, cap, disclosure, catchAll, recipients, ceiling, handsOn] = await Promise.all([
    getSetting(db, "publishing.requireHumanReview"),
    getSetting(db, "publishing.dailyCap"),
    getSetting(db, "editorial.aiDisclosure"),
    getSetting(db, "affiliate.catchAllFallback"),
    getSetting(db, "notifications.recipients"),
    getSetting(db, "costs.defaultCeilingUsd"),
    getSetting(db, "pipeline.handsOnTrials"),
  ]);
  const beforeThreshold = published < HUMAN_REVIEW_UNTIL_PUBLISHED;
  const items: CheckItem[] = [
    {
      id: "settings.human_review",
      label: "Human review required (D-3)",
      status: requireReview !== false ? "pass" : beforeThreshold ? "fail" : "pass",
      detail:
        requireReview !== false
          ? beforeThreshold
            ? `On. Keep it on until ${HUMAN_REVIEW_UNTIL_PUBLISHED} published articles (${published} now).`
            : `On. ${published} articles published: D-3 can be revisited.`
          : beforeThreshold
            ? `publishing.requireHumanReview is false with only ${published} published articles; D-3 keeps it on until ${HUMAN_REVIEW_UNTIL_PUBLISHED}.`
            : `Off after ${published} published articles (D-3 revisited).`,
    },
    {
      id: "settings.daily_cap",
      label: `Publishing cadence cap (D-7: ${LAUNCH_DAILY_CAP}/day at launch)`,
      status: cap === undefined || cap === 0 ? "warn" : cap > LAUNCH_DAILY_CAP && beforeThreshold ? "warn" : "pass",
      detail:
        cap === undefined
          ? "publishing.dailyCap is not set."
          : cap === 0
            ? "publishing.dailyCap is 0: nothing can be published."
            : `${cap} per UTC day${cap > LAUNCH_DAILY_CAP && beforeThreshold ? `; D-7 starts at ${LAUNCH_DAILY_CAP} and raises it gradually` : ""}.`,
    },
    {
      id: "settings.ai_disclosure",
      label: "AI disclosure text (FR-CON-10)",
      status: disclosure?.trim() ? "pass" : "fail",
      detail: disclosure?.trim()
        ? `“${disclosure.trim()}”`
        : "editorial.aiDisclosure is empty; publishing is blocked by the QA gate.",
    },
    {
      id: "settings.catch_all",
      label: "Catch-all monetisation fallback (D-4)",
      status: catchAll?.enabled && catchAll.network && catchAll.publisherId ? "pass" : "warn",
      detail: !catchAll?.enabled
        ? "Disabled: products without a program redirect to the vendor with UTM only."
        : !catchAll.network || !catchAll.publisherId
          ? "Enabled, but no network/publisherId yet: fallbacks go to the vendor with UTM until you add Skimlinks or Sovrn."
          : `${catchAll.network} (${catchAll.publisherId}) wraps vendor fallbacks.`,
    },
    {
      id: "settings.recipients",
      label: "Notification recipients",
      status: recipients?.length ? "pass" : "warn",
      detail: recipients?.length ? recipients.join(", ") : "notifications.recipients is empty: emails go nowhere.",
    },
    {
      id: "settings.cost_ceiling",
      label: "Default cost ceiling per job (FR-INT-6)",
      status: ceiling ? "pass" : "warn",
      detail: ceiling
        ? `Jobs pause for approval above $${ceiling}.`
        : "No default ceiling: a runaway job is not paused.",
    },
  ];
  if (handsOn) {
    items.push({
      id: "settings.hands_on",
      label: "Hands-on trials vault key (D-6)",
      status: has(env, "VAULT_KEY") ? "pass" : "fail",
      detail: has(env, "VAULT_KEY")
        ? "pipeline.handsOnTrials is on and VAULT_KEY is set."
        : "pipeline.handsOnTrials is on but VAULT_KEY is missing on the CMS.",
    });
  }
  return items;
}

async function contentItems(db: DbOrTx, published: number): Promise<CheckItem[]> {
  const slugs = LAUNCH_CATEGORIES.map((c) => c.slug);
  const rows = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .where(inArray(categories.slug, slugs));
  const counts = await db
    .select({ slug: categories.slug, n: sql<number>`count(${articles.id})::int` })
    .from(categories)
    .innerJoin(products, eq(products.categoryId, categories.id))
    .innerJoin(
      articles,
      and(
        eq(articles.productId, products.id),
        eq(articles.type, "review"),
        eq(articles.status, "published"),
        eq(articles.locale, "en"),
      ),
    )
    .where(inArray(categories.slug, slugs))
    .groupBy(categories.slug);
  const bySlug = new Map(counts.map((c) => [c.slug, Number(c.n)]));
  const present = new Map(rows.map((r) => [r.slug, r]));
  const items: CheckItem[] = LAUNCH_CATEGORIES.map((c): CheckItem => {
    const n = bySlug.get(c.slug) ?? 0;
    return {
      id: `content.category.${c.slug}`,
      label: `Launch category: ${c.name} (D-2)`,
      status: !present.has(c.slug) ? "fail" : n > 0 ? "pass" : "warn",
      detail: !present.has(c.slug)
        ? "Category missing: run the seed (node scripts/prod.mjs db:seed)."
        : n > 0
          ? `${n} published review${n === 1 ? "" : "s"}.`
          : "No published review yet.",
      evidence: { publishedReviews: n },
    };
  });
  items.push({
    id: "content.published",
    label: `${LAUNCH_MIN_PUBLISHED_REVIEWS} real products reviewed end to end (Phase 4 exit)`,
    status: published >= LAUNCH_MIN_PUBLISHED_REVIEWS ? "pass" : "warn",
    detail: `${published} published review${published === 1 ? "" : "s"}; check each job in the table below.`,
  });
  return items;
}

type Page = { status: number | null; html: string | null; error: string | null };

async function fetchPage(url: string, opts: Required<Pick<ReadinessOptions, "timeoutMs">> & { fetch: typeof fetch }) {
  try {
    const res = await opts.fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { "user-agent": "ai-review-readiness-check (monitor)" },
    });
    const html = (res.headers.get("content-type") ?? "").includes("html") ? await res.text() : null;
    return { status: res.status, html, error: null } satisfies Page;
  } catch (error) {
    return { status: null, html: null, error: error instanceof Error ? error.message : String(error) } satisfies Page;
  }
}

const NOINDEX = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i;

function pageItem(id: string, label: string, url: string, page: Page): CheckItem {
  const status: CheckStatus = page.status === null ? "warn" : page.status === 200 ? "pass" : "fail";
  return {
    id,
    label,
    status,
    detail:
      page.status === null
        ? `Could not reach ${url} (${page.error}).`
        : page.status === 200
          ? `${url} returns 200.`
          : `${url} returns ${page.status}.`,
  };
}

async function siteItems(
  siteUrl: string | null,
  opts: { fetch: typeof fetch; timeoutMs: number },
): Promise<CheckItem[]> {
  if (!siteUrl) {
    return [
      {
        id: "site.url",
        label: "Public site URL",
        status: "fail",
        detail: "NEXT_PUBLIC_SITE_URL is not set, so the public pages cannot be checked.",
      },
    ];
  }
  const pages = [
    { id: "site.health", label: "Public site health endpoint", path: "/api/health" },
    { id: "site.affiliate_disclosure", label: "Affiliate disclosure page (FR-AFF-14)", path: "/affiliate-disclosure" },
    { id: "site.editorial_policy", label: "Editorial policy page", path: "/editorial-policy" },
  ];
  const results = await Promise.all(pages.map((p) => fetchPage(`${siteUrl}${p.path}`, opts)));
  return pages.map((p, i) => pageItem(p.id, p.label, `${siteUrl}${p.path}`, results[i]!));
}

async function germanItems(
  db: DbOrTx,
  siteUrl: string | null,
  opts: { fetch: typeof fetch; timeoutMs: number },
): Promise<CheckItem[]> {
  const policy = await getSetting(db, "i18n.policy");
  const enabled = policy?.enabledLocales.includes("de") ?? false;
  if (!enabled) {
    return [
      {
        id: "de.public",
        label: "German locale",
        status: "n/a",
        detail: `German is not public (i18n.policy.enabledLocales = ${JSON.stringify(policy?.enabledLocales ?? ["en"])}). Fill apps/web/lib/legal.ts before adding "de".`,
      },
    ];
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(articles)
    .where(and(eq(articles.status, "published"), eq(articles.locale, "de")));
  const germanPublished = Number(row?.n ?? 0);
  const items: CheckItem[] = [
    {
      id: "de.articles",
      label: "Published German articles",
      status: germanPublished > 0 ? "pass" : "warn",
      detail: `${germanPublished} published in German.`,
    },
  ];
  if (!siteUrl) {
    items.push({
      id: "de.impressum",
      label: "Impressum complete",
      status: "fail",
      detail: "NEXT_PUBLIC_SITE_URL is not set.",
    });
    return items;
  }
  const url = `${siteUrl}/impressum`;
  const page = await fetchPage(url, opts);
  if (page.status === null || page.status !== 200 || page.html === null) {
    items.push({
      ...pageItem("de.impressum", "Impressum complete (DDG § 5, MStV § 18)", url, page),
      status: page.status === null ? "warn" : "fail",
    });
    return items;
  }
  const noindex = NOINDEX.test(page.html);
  items.push({
    id: "de.impressum",
    label: "Impressum complete (DDG § 5, MStV § 18)",
    status: noindex ? "fail" : "pass",
    detail: noindex
      ? "The Impressum is still noindex, i.e. apps/web/lib/legal.ts has missing required fields. Fill them and redeploy the web app."
      : "Impressum is indexable (all required legal fields filled).",
  });
  return items;
}

/** Runs every readiness check. Network checks against the public site never throw (`warn`). */
export async function evaluateReadiness(
  db: DbOrTx,
  env: ReadinessEnv,
  opts: ReadinessOptions = {},
): Promise<ReadinessReport> {
  const siteUrl = (opts.siteUrl ?? env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "") || null;
  const net = { fetch: opts.fetch ?? fetch, timeoutMs: opts.timeoutMs ?? 4000 };
  const published = await publishedReviewCount(db);
  const [people, settingsList, content, site, german] = await Promise.all([
    peopleItems(db),
    settingsItems(db, env, published),
    contentItems(db, published),
    siteItems(siteUrl, net),
    germanItems(db, siteUrl, net),
  ]);
  const groups: ReadinessGroup[] = [
    { id: "env", label: "CMS environment", items: envItems(env) },
    { id: "people", label: "Accounts", items: people },
    { id: "settings", label: "Settings (SRS §9 decisions)", items: settingsList },
    { id: "content", label: "Launch content", items: content },
    { id: "site", label: "Public site", items: site },
    { id: "de", label: "German locale", items: german },
  ];
  return { groups, summary: countStatuses(groups.flatMap((g) => g.items)) };
}
