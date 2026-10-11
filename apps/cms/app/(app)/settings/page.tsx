import { listAuthors, listPromptVersions, getActivePromptOverride, settingSchemas } from "@repo/core";
import { asc, categories, getDb, settings } from "@repo/db";
import { PROMPT_KEYS, PROMPTS } from "@repo/pipeline/editor";
import { Button } from "@repo/ui/button";
import { Input, Label } from "@repo/ui/input";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { PageHeader, StatusBadge, Tabs } from "../../../components/ui";
import { requireUser } from "../../../lib/auth";
import {
  activatePromptAction,
  saveAuthorAction,
  savePromptAction,
  saveRubricAction,
  saveSettingAction,
} from "./actions";

export const metadata = { title: "Settings" };

const INTEGRATIONS: Array<{ label: string; vars: string[] }> = [
  { label: "Anthropic (Claude)", vars: ["ANTHROPIC_API_KEY"] },
  { label: "Firecrawl", vars: ["FIRECRAWL_API_KEY"] },
  { label: "Voyage embeddings", vars: ["VOYAGE_API_KEY"] },
  { label: "Trigger.dev worker", vars: ["TRIGGER_SECRET_KEY"] },
  { label: "Upstash Redis", vars: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] },
  {
    label: "Cloudflare R2 media",
    vars: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "NEXT_PUBLIC_MEDIA_URL"],
  },
  { label: "Web revalidation", vars: ["REVALIDATE_SECRET", "NEXT_PUBLIC_SITE_URL"] },
  { label: "Sentry error monitoring", vars: ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"] },
  { label: "Sentry source maps (build)", vars: ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"] },
  { label: "Notification email (Resend)", vars: ["RESEND_API_KEY", "NOTIFY_EMAIL_FROM"] },
  { label: "Notification webhook (Slack)", vars: ["NOTIFY_WEBHOOK_URL"] },
  { label: "Notification Telegram bot", vars: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] },
  { label: "Generative images (fal.ai)", vars: ["FAL_KEY"] },
];

/** One line per setting so the JSON editors are self-explanatory. */
const SETTING_HELP: Record<string, string> = {
  "publishing.dailyCap":
    "Most first publications per UTC day (NFR-10). Auto-published articles over the cap are scheduled.",
  "publishing.requireHumanReview":
    "Global switch. While true, nothing is auto-published, whatever the categories below say (D-3).",
  "publishing.autoPublishCategories":
    "Category slugs whose articles may publish without review when all hard gates pass (FR-QA-4).",
  "publishing.autoPublish": "minSoftScore: share of soft QA checks (0–1) an article needs to auto-publish.",
  "affiliate.catchAllFallback":
    'Wrap vendor fallbacks in a catch-all network: network "skimlinks" or "sovrn" plus your publisherId (FR-AFF-5).',
  "costs.defaultCeilingUsd":
    "Jobs without their own ceiling pause for approval above this spend (FR-INT-6). null = none.",
  "costs.targetPerReviewUsd":
    "Cost targets per review; a job above target × alertMultiplier sends a cost alert (NFR-6).",
  "refresh.policy":
    "Refresh scheduler (FR-MNT-1): product interval (default 60 days), top-traffic interval and threshold, jobs per daily run.",
  "linkHealth.policy": "Daily link check (FR-AFF-10): consecutive failures before a link is paused as broken.",
  "notifications.recipients": "Email addresses that receive notification emails (FR-CMS-8).",
  "notifications.events":
    'Per-event channel overrides, e.g. {"job.succeeded": {"email": false, "webhook": true}}. See the Notifications page for event names.',
  "sourcing.policy":
    "Product sourcing cron (FR-INT-7): set enabled to true to fill Suggested products daily. Product Hunt needs PRODUCT_HUNT_TOKEN.",
  "video.settings": "Video pipeline (FR-VID): voice, kinds, YouTube privacy and auto-generation after first publish.",
  "pipeline.videoEnabled": "Master switch for the video pipeline (D-5).",
};

const area = "w-full rounded-md border border-border bg-bg p-2 font-mono text-xs";

/** Settings (FR-CMS-7): typed settings, prompts, rubric per category, authors, integrations. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; prompt?: string }>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const { tab = "general", prompt = "write" } = await searchParams;
  const db = getDb();
  const rows = await db.select().from(settings).orderBy(asc(settings.key));
  const values = new Map(rows.map((r) => [r.key, r.value]));
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle={isAdmin ? "Changes are audited." : "Read-only for editors."} />
      <Tabs
        active={tab}
        tabs={[
          { key: "general", label: "General", href: "/settings?tab=general" },
          { key: "prompts", label: "Prompts", href: "/settings?tab=prompts" },
          { key: "rubrics", label: "Rubrics", href: "/settings?tab=rubrics" },
          { key: "authors", label: "Authors", href: "/settings?tab=authors" },
          { key: "integrations", label: "Integrations", href: "/settings?tab=integrations" },
          { key: "evals", label: "Prompt evals", href: "/settings/evals" },
        ]}
      />

      {tab === "general" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Object.keys(settingSchemas).map((key) => {
            const value = JSON.stringify(values.get(key) ?? null, null, 2);
            return (
              <ActionForm
                key={key}
                action={saveSettingAction}
                className="space-y-2 rounded-lg border border-border bg-bg p-4"
              >
                <input type="hidden" name="key" value={key} />
                <Label className="font-mono">{key}</Label>
                {SETTING_HELP[key] ? <p className="text-xs text-muted">{SETTING_HELP[key]}</p> : null}
                <textarea
                  name="value"
                  defaultValue={value}
                  rows={Math.min(14, value.split("\n").length + 1)}
                  className={area}
                  disabled={!isAdmin}
                />
                {isAdmin ? (
                  <SubmitButton size="sm" variant="secondary">
                    Save
                  </SubmitButton>
                ) : null}
              </ActionForm>
            );
          })}
        </div>
      ) : null}

      {tab === "prompts" ? <PromptsTab active={prompt} isAdmin={isAdmin} /> : null}

      {tab === "rubrics" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            JSON array of {"{key, label, weight}"} with weights summing to 1. Leave empty for the default rubric. Keys
            should match the writer&apos;s dimensions (features, ease_of_use, value, support, integrations, security) or
            new ones you describe in the label.
          </p>
          {(await db.select().from(categories).orderBy(asc(categories.position))).map((c) => (
            <ActionForm
              key={c.id}
              action={saveRubricAction}
              className="space-y-2 rounded-lg border border-border bg-bg p-4"
            >
              <input type="hidden" name="categoryId" value={c.id} />
              <Label>{c.name}</Label>
              <textarea
                name="rubric"
                defaultValue={c.rubric ? JSON.stringify(c.rubric, null, 2) : ""}
                rows={c.rubric ? 10 : 2}
                className={area}
                disabled={!isAdmin}
              />
              {isAdmin ? (
                <SubmitButton size="sm" variant="secondary">
                  Save
                </SubmitButton>
              ) : null}
            </ActionForm>
          ))}
        </div>
      ) : null}

      {tab === "authors" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {(await listAuthors(db)).map((a) => (
            <ActionForm
              key={a.id}
              action={saveAuthorAction}
              className="space-y-2 rounded-lg border border-border bg-bg p-4"
            >
              <input type="hidden" name="authorId" value={a.id} />
              <p className="text-xs text-muted">/authors/{a.slug}</p>
              <div>
                <Label>Name</Label>
                <Input name="name" defaultValue={a.name} disabled={!isAdmin} />
              </div>
              <div>
                <Label>Bio (shown on author pages; real experience builds trust)</Label>
                <textarea
                  name="bio"
                  defaultValue={a.bio ?? ""}
                  rows={4}
                  className="w-full rounded-md border border-border bg-bg p-2 text-sm"
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label>Links (JSON)</Label>
                <Input name="links" defaultValue={JSON.stringify(a.links)} disabled={!isAdmin} />
              </div>
              {isAdmin ? (
                <SubmitButton size="sm" variant="secondary">
                  Save
                </SubmitButton>
              ) : null}
            </ActionForm>
          ))}
        </div>
      ) : null}

      {tab === "integrations" ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-bg">
          {INTEGRATIONS.map((i) => {
            const missing = i.vars.filter((v) => !process.env[v]);
            return (
              <li key={i.label} className="flex items-center justify-between gap-4 p-4 text-sm">
                <span>{i.label}</span>
                <span className="flex items-center gap-2">
                  {missing.length ? (
                    <span className="font-mono text-xs text-muted">missing: {missing.join(", ")}</span>
                  ) : null}
                  <StatusBadge status={missing.length ? "pending" : "active"} />
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

async function PromptsTab({ active, isAdmin }: { active: string; isAdmin: boolean }) {
  const db = getDb();
  const key = (PROMPT_KEYS as string[]).includes(active) ? (active as (typeof PROMPT_KEYS)[number]) : "write";
  const def = PROMPTS[key];
  const [override, versions] = await Promise.all([getActivePromptOverride(db, key), listPromptVersions(db, key)]);
  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
      <nav className="space-y-1 text-sm">
        {PROMPT_KEYS.map((k) => (
          <a
            key={k}
            href={`/settings?tab=prompts&prompt=${k}`}
            className={`block rounded px-2 py-1 font-mono ${k === key ? "bg-surface font-semibold" : "hover:bg-surface"}`}
          >
            {k}
          </a>
        ))}
      </nav>
      <div className="space-y-4">
        <div className="text-sm">
          <p>{def.description}</p>
          <p className="mt-1 text-muted">
            Repo default: v{def.version} · {def.model} · effort {def.effort}. Model/effort overrides live in the{" "}
            <code>pipeline.stepModels</code> setting. Active:{" "}
            {override ? `CMS v${override.version}` : `repo v${def.version}`}.
          </p>
        </div>
        <ActionForm action={savePromptAction} className="space-y-2">
          <input type="hidden" name="key" value={key} />
          <textarea
            name="body"
            defaultValue={override?.body ?? def.system}
            rows={24}
            className={area}
            disabled={!isAdmin}
          />
          <div className="flex items-center gap-3">
            <Input name="notes" placeholder="What changed and why" className="max-w-md" disabled={!isAdmin} />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="activate" defaultChecked disabled={!isAdmin} /> activate
            </label>
            {isAdmin ? <SubmitButton size="sm">Save new version</SubmitButton> : null}
          </div>
          <p className="text-xs text-muted">
            {"{{STYLE_GUIDE}}"} is replaced with the editorial.styleGuide setting (or the default) plus banned phrases.
            Promote a good override into the repo as the next version (docs: packages/pipeline/prompts/README.md).
          </p>
        </ActionForm>
        {versions.length ? (
          <ul className="space-y-1 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-3">
                <span className="font-mono">v{v.version}</span>
                {v.active ? <StatusBadge status="active" /> : null}
                <span className="text-muted">{v.notes}</span>
                {isAdmin && !v.active ? (
                  <form action={activatePromptAction}>
                    <input type="hidden" name="key" value={key} />
                    <input type="hidden" name="version" value={v.version} />
                    <Button type="submit" size="sm" variant="ghost">
                      Activate
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
            {isAdmin && override ? (
              <li>
                <form action={activatePromptAction}>
                  <input type="hidden" name="key" value={key} />
                  <input type="hidden" name="version" value="" />
                  <Button type="submit" size="sm" variant="ghost">
                    Revert to repo default
                  </Button>
                </form>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
