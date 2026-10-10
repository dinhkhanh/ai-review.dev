import { localizedArticlePath } from "@repo/content";
import {
  DEFAULT_DECAY_POLICY,
  getSetting,
  listDecayingArticles,
  searchConsoleStatus,
  topQueriesForArticles,
  type DecaySignal,
} from "@repo/core";
import { desc, eq, getDb, notifications } from "@repo/db";
import { Input, Label } from "@repo/ui/input";
import Link from "next/link";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { Empty, fmtDate, Notice, PageHeader, Table } from "../../../components/ui";
import { refreshProductAction } from "../products/actions";
import { dismissDecayAction, importSearchConsoleNowAction } from "./actions";

export const metadata = { title: "Content decay" };

const num = new Intl.NumberFormat("en-US");
const fmtPos = (p: number | null | undefined) => (p == null ? "–" : p.toFixed(1));
const pct = (x: number | null | undefined) => (x == null ? "–" : `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`);
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** "Needs refresh" list (FR-MNT-3): live articles whose Search Console clicks or rankings fell. */
export default async function DecayPage() {
  const db = getDb();
  const configured = Boolean(process.env.GSC_CLIENT_EMAIL && process.env.GSC_PRIVATE_KEY && process.env.GSC_SITE_URL);
  const [rows, status, policy, [lastFailure]] = await Promise.all([
    listDecayingArticles(db),
    searchConsoleStatus(db),
    getSetting(db, "searchConsole.policy"),
    db
      .select({ createdAt: notifications.createdAt, body: notifications.body })
      .from(notifications)
      .where(eq(notifications.event, "searchConsole.failed"))
      .orderBy(desc(notifications.createdAt))
      .limit(1),
  ]);
  const p = policy ?? DEFAULT_DECAY_POLICY;
  const queries = await topQueriesForArticles(
    db,
    rows.map((r) => r.id),
    3,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content decay"
        subtitle={
          <>
            Live articles whose Search Console clicks fell at least {Math.round(p.minClickDrop * 100)}% (from at least{" "}
            {p.minBaselineClicks} clicks) or lost 3+ positions, last {p.windowDays} days vs the {p.windowDays} before.
            Detection is {p.enabled ? "on" : "off"}; flagged products {p.scheduleRefresh ? "are" : "are not"} moved up
            the refresh queue (
            <Link href="/settings" className="underline">
              settings
            </Link>
            ).
          </>
        }
      />
      {!configured ? (
        <Notice>
          Search Console is not connected: set GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY and GSC_SITE_URL on the worker (and
          CMS). See docs/deploy.md, “Phase 3 rollout”.
        </Notice>
      ) : null}
      {lastFailure && (!status.latestDay || lastFailure.createdAt > new Date(`${status.latestDay}T00:00:00Z`)) ? (
        <Notice tone="error">
          Last import failed {fmtDate(lastFailure.createdAt)}: {lastFailure.body}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border p-4 text-sm">
        <p>
          {status.latestDay ? (
            <>
              Data {status.firstDay} → <span className="font-medium">{status.latestDay}</span> ·{" "}
              {num.format(status.rows)} page-days · {status.articlePages} article pages. Imported daily at 03:55 UTC.
            </>
          ) : (
            "No Search Console data imported yet."
          )}
        </p>
        <ActionForm action={importSearchConsoleNowAction} className="flex items-end gap-2">
          <div>
            <Label htmlFor="gsc-days">Days</Label>
            <Input id="gsc-days" name="days" type="number" min={1} max={486} placeholder="10" className="w-24" />
          </div>
          <SubmitButton size="sm" variant="secondary" pendingLabel="Starting…">
            Import now
          </SubmitButton>
        </ActionForm>
      </div>

      {rows.length === 0 ? (
        <Empty>No decaying pages. {status.latestDay ? "" : "Import Search Console data to start detection."}</Empty>
      ) : (
        <Table head={["Article", "Clicks", "Impressions", "Position", "Top queries", "Flagged", "Last refreshed", ""]}>
          {rows.map((r) => {
            const s = r.signal as DecaySignal | null;
            const top = queries.get(r.id) ?? [];
            const canRefresh = Boolean(r.productId && !r.productDiscontinuedAt);
            return (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="max-w-xs p-3">
                  <Link href={`/articles/${r.id}`} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                  <p className="text-xs text-muted">
                    {r.locale} ·{" "}
                    <a
                      href={`${siteUrl}${localizedArticlePath(r.type, r.slug, r.locale)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      view
                    </a>
                    {s?.reasons.length ? ` · ${s.reasons.join(", ")}` : null}
                  </p>
                </td>
                <td className="p-3 tabular-nums">
                  {num.format(s?.previous.clicks ?? 0)} → {num.format(s?.current.clicks ?? 0)}
                  <p className="text-xs text-danger">{pct(s?.clickChange)}</p>
                </td>
                <td className="p-3 tabular-nums">
                  {num.format(s?.previous.impressions ?? 0)} → {num.format(s?.current.impressions ?? 0)}
                </td>
                <td className="p-3 tabular-nums">
                  {fmtPos(s?.previous.position)} → {fmtPos(s?.current.position)}
                </td>
                <td className="max-w-xs p-3 text-xs">
                  {top.length
                    ? top.map((q) => (
                        <p key={q.query}>
                          {q.query} <span className="text-muted">({q.clicks})</span>
                        </p>
                      ))
                    : "–"}
                </td>
                <td className="p-3 text-xs">{fmtDate(r.decayDetectedAt)}</td>
                <td className="p-3 text-xs">
                  {fmtDate(r.lastVerifiedAt)}
                  {r.productNextRefreshAt ? (
                    <p className="text-muted">next: {fmtDate(r.productNextRefreshAt)}</p>
                  ) : null}
                </td>
                <td className="space-y-2 p-3">
                  {canRefresh ? (
                    <form action={refreshProductAction}>
                      <input type="hidden" name="productId" value={r.productId!} />
                      <SubmitButton size="sm" pendingLabel="Starting…">
                        Refresh now
                      </SubmitButton>
                    </form>
                  ) : (
                    <p className="text-xs text-muted">
                      {r.productId ? "Product discontinued" : "Multi-product page: refresh its products"}
                    </p>
                  )}
                  <form action={dismissDecayAction}>
                    <input type="hidden" name="articleId" value={r.id} />
                    <SubmitButton size="sm" variant="secondary" pendingLabel="…">
                      Dismiss
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
