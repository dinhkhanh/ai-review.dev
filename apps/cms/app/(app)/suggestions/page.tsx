import { getSetting, listSuggestions, suggestionCounts, type SuggestionStatus } from "@repo/core";
import { getDb } from "@repo/db";
import { Button } from "@repo/ui/button";
import { Input, Label } from "@repo/ui/input";
import Link from "next/link";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { Empty, fmtDate, Notice, PageHeader, Table, Tabs } from "../../../components/ui";
import {
  acceptSuggestionAction,
  addSuggestionAction,
  runSourcingNowAction,
  setSuggestionStatusAction,
} from "./actions";

export const metadata = { title: "Suggested products" };

const STATUSES: Array<{ key: SuggestionStatus; label: string }> = [
  { key: "new", label: "Queue" },
  { key: "accepted", label: "Accepted" },
  { key: "dismissed", label: "Dismissed" },
];

/** Shape written by runProductSourcing (packages/pipeline/src/sourcing/run.ts `buildSignals`). */
interface Signals {
  description?: string | null;
  launch?: {
    url: string | null;
    title: string;
    votes: number | null;
    points: number | null;
    comments: number | null;
    publishedAt: string | null;
    topics: string[];
  };
  category?: { categorySlug: string | null; confidence: number; reason: string } | null;
  affiliate?: {
    probed: boolean;
    found: boolean;
    url: string | null;
    recurring: boolean;
    commissionPercent: number | null;
    cookieDays: number | null;
    network: string | null;
    evidence: string | null;
  };
  components?: { affiliate: number; demand: number; fit: number; freshness: number };
}

function affiliateSummary(a: NonNullable<Signals["affiliate"]>) {
  if (!a.probed) return "Not checked";
  if (!a.found) return "No program found";
  const parts = [
    a.commissionPercent !== null
      ? `${a.commissionPercent}%${a.recurring ? " recurring" : ""}`
      : a.recurring
        ? "recurring"
        : null,
    a.cookieDays !== null ? `${a.cookieDays}-day cookie` : null,
    a.network,
  ].filter(Boolean);
  return `Program found${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

function Evidence({ signals, source }: { signals: Signals; source: string }) {
  const { launch, affiliate, category } = signals;
  const traction =
    launch?.votes !== null && launch?.votes !== undefined
      ? `${launch.votes} votes`
      : launch?.points !== null && launch?.points !== undefined
        ? `${launch.points} points`
        : null;
  return (
    <div className="space-y-1 text-xs">
      <p>
        <span className="font-medium">{source}</span>
        {launch?.url ? (
          <>
            {" · "}
            <a href={launch.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
              launch post
            </a>
          </>
        ) : null}
        {traction ? ` · ${traction}` : null}
        {launch?.comments ? ` · ${launch.comments} comments` : null}
        {launch?.publishedAt ? ` · ${launch.publishedAt.slice(0, 10)}` : null}
      </p>
      {affiliate ? (
        <p>
          {affiliate.url ? (
            <a href={affiliate.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {affiliateSummary(affiliate)}
            </a>
          ) : (
            affiliateSummary(affiliate)
          )}
        </p>
      ) : null}
      {affiliate?.evidence ? <p className="italic text-muted">“{affiliate.evidence}”</p> : null}
      {category ? (
        <p className="text-muted">
          Fit {Math.round(category.confidence * 100)}%: {category.reason}
        </p>
      ) : null}
    </div>
  );
}

/** "Suggested products" queue (FR-INT-7): ranked by expected value, accept into a job or dismiss. */
export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { status: raw = "new", error } = await searchParams;
  const status = STATUSES.some((s) => s.key === raw) ? (raw as SuggestionStatus) : "new";
  const db = getDb();
  const [rows, counts, policy] = await Promise.all([
    listSuggestions(db, { status, limit: 200 }),
    suggestionCounts(db),
    getSetting(db, "sourcing.policy"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suggested products"
        subtitle={
          <>
            New launches ranked by expected value: category fit × freshness × affiliate terms × launch traction. Daily
            sourcing is {policy?.enabled ? "on" : "off"} (
            <Link href="/settings" className="underline">
              settings
            </Link>
            ).
          </>
        }
        actions={
          <ActionForm action={runSourcingNowAction}>
            <SubmitButton size="sm" variant="secondary" pendingLabel="Starting…">
              Run sourcing now
            </SubmitButton>
          </ActionForm>
        }
      />
      {error ? <Notice tone="error">{error}</Notice> : null}

      <ActionForm action={addSuggestionAction} className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="suggest-url">Add a product to the queue</Label>
            <Input id="suggest-url" name="url" placeholder="https://product.com or a Product Hunt post URL" required />
          </div>
          <SubmitButton pendingLabel="Evaluating…">Evaluate</SubmitButton>
        </div>
        <p className="mt-2 text-xs text-muted">
          Classified, checked for an affiliate program and scored like the daily run.
        </p>
      </ActionForm>

      <Tabs
        active={status}
        tabs={STATUSES.map((s) => ({
          key: s.key,
          label: s.label,
          href: `/suggestions?status=${s.key}`,
          count: counts[s.key],
        }))}
      />
      {rows.length === 0 ? (
        <Empty>{status === "new" ? "No suggestions yet. Run sourcing or add a product above." : "Nothing here."}</Empty>
      ) : (
        <Table head={["Score", "Product", "Category", "Evidence", "Found", ""]}>
          {rows.map((s) => {
            const signals = (s.signals ?? {}) as Signals;
            const c = signals.components;
            return (
              <tr key={s.id} className="border-t border-border align-top">
                <td
                  className="p-3 font-semibold tabular-nums"
                  title={
                    c
                      ? `fit ${c.fit} × freshness ${c.freshness} × (0.5 + affiliate ${c.affiliate}) × (0.5 + demand ${c.demand})`
                      : undefined
                  }
                >
                  {Number(s.score).toFixed(2)}
                </td>
                <td className="max-w-xs p-3">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    {s.name}
                  </a>
                  <p className="text-xs text-muted">{s.domain}</p>
                  {signals.description ? <p className="mt-1 text-xs">{signals.description}</p> : null}
                </td>
                <td className="p-3">{s.categorySlug ?? "—"}</td>
                <td className="max-w-md p-3">
                  <Evidence signals={signals} source={s.source} />
                </td>
                <td className="p-3 tabular-nums">{fmtDate(s.createdAt)}</td>
                <td className="p-3">
                  <div className="flex flex-col items-end gap-1">
                    {s.status === "accepted" && s.jobId ? (
                      <Link href={`/jobs/${s.jobId}`} className="text-sm text-brand hover:underline">
                        Open job
                      </Link>
                    ) : null}
                    {s.status !== "accepted" ? (
                      <form action={acceptSuggestionAction}>
                        <input type="hidden" name="suggestionId" value={s.id} />
                        <SubmitButton size="sm" pendingLabel="Creating job…">
                          Accept
                        </SubmitButton>
                      </form>
                    ) : null}
                    {s.status === "new" || s.status === "dismissed" ? (
                      <form action={setSuggestionStatusAction}>
                        <input type="hidden" name="suggestionId" value={s.id} />
                        <input type="hidden" name="status" value={s.status === "new" ? "dismissed" : "new"} />
                        <Button type="submit" size="sm" variant="ghost">
                          {s.status === "new" ? "Dismiss" : "Restore"}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
