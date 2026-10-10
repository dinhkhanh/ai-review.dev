import { clickSummary, listLinkHealth, listPrograms, recentClicks } from "@repo/core";
import { getDb } from "@repo/db";
import { Button } from "@repo/ui/button";
import Link from "next/link";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { Empty, fmtDate, PageHeader, StatusBadge, Table, Tabs } from "../../../components/ui";
import { setProgramStatusAction } from "../products/actions";
import { checkAllLinksAction, checkLinkNowAction } from "./actions";

export const metadata = { title: "Affiliate" };

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

/** Affiliate workspace (FR-CMS-6, FR-AFF-2): programs to apply to, active programs, clicks. */
export default async function AffiliatePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "apply" } = await searchParams;
  const db = getDb();
  const [toApply, pending, active, summary, clicks, health] = await Promise.all([
    listPrograms(db, { statuses: ["found"] }),
    listPrograms(db, { statuses: ["applied", "approved"] }),
    listPrograms(db, { statuses: ["active", "paused"] }),
    clickSummary(db, daysAgo(30)),
    recentClicks(db, 50),
    listLinkHealth(db),
  ]);
  const failing = health.filter((l) => l.status === "broken" || l.healthFailures > 0).length;
  const rows = view === "apply" ? toApply : view === "pending" ? pending : active;
  return (
    <div className="space-y-6">
      <PageHeader title="Affiliate" subtitle={`${summary.total} human clicks in the last 30 days`} />
      <Tabs
        active={view}
        tabs={[
          { key: "apply", label: "To apply", href: "/affiliate?view=apply", count: toApply.length },
          { key: "pending", label: "Applied / approved", href: "/affiliate?view=pending", count: pending.length },
          { key: "active", label: "Active", href: "/affiliate?view=active", count: active.length },
          { key: "clicks", label: "Clicks", href: "/affiliate?view=clicks" },
          { key: "health", label: "Link health", href: "/affiliate?view=health", count: failing },
        ]}
      />
      {view === "health" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-2xl text-sm text-muted">
              Every active and pending link is followed daily. Links that fail the configured number of checks in a row
              are paused as broken and the go-link falls back to the next link or the vendor URL. Re-activate a fixed
              link on its product page.
            </p>
            <ActionForm action={checkAllLinksAction}>
              <SubmitButton size="sm" variant="secondary" pendingLabel="Checking…">
                Check all links now
              </SubmitButton>
            </ActionForm>
          </div>
          {health.length ? (
            <Table head={["Product", "Link", "Status", "Last check", "Result", ""]}>
              {health.map((l) => (
                <tr key={l.id} className="border-t border-border align-top">
                  <td className="p-3">
                    <Link href={`/products/${l.productId}?tab=affiliate`} className="font-medium hover:underline">
                      {l.productName}
                    </Link>
                  </td>
                  <td className="max-w-xs p-3">
                    {l.label}
                    <p className="break-all font-mono text-xs text-muted">{l.destinationUrl}</p>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={l.status} />
                    {l.healthFailures > 0 ? (
                      <p className="mt-1 text-xs text-danger">{l.healthFailures} failed in a row</p>
                    ) : null}
                  </td>
                  <td className="p-3 tabular-nums">{fmtDate(l.lastHealthCheckAt)}</td>
                  <td className="max-w-md p-3 text-xs">
                    {l.healthDetail ?? "—"}
                    {l.finalUrl ? <p className="mt-1 break-all text-muted">→ {l.finalUrl}</p> : null}
                  </td>
                  <td className="p-3">
                    <form action={checkLinkNowAction}>
                      <input type="hidden" name="linkId" value={l.id} />
                      <input type="hidden" name="productId" value={l.productId} />
                      <Button type="submit" size="sm" variant="ghost">
                        Check now
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No affiliate links yet.</Empty>
          )}
        </section>
      ) : view !== "clicks" ? (
        rows.length ? (
          <Table head={["Product", "Program", "Network", "Commission", "Status", "Sign up", ""]}>
            {rows.map(({ program: p, productName }) => (
              <tr key={p.id} className="border-t border-border align-top">
                <td className="p-3">
                  <Link href={`/products/${p.productId}?tab=affiliate`} className="font-medium hover:underline">
                    {productName}
                  </Link>
                </td>
                <td className="p-3">{p.name}</td>
                <td className="p-3">{p.network}</td>
                <td className="p-3 tabular-nums">
                  {p.commissionValue ? `${p.commissionValue}${p.commissionModel.includes("percent") ? "%" : ""}` : "—"}{" "}
                  <span className="text-xs text-muted">
                    {p.commissionModel.replace(/_/g, " ")}
                    {p.recurringMonths ? ` · ${p.recurringMonths} mo` : ""}
                    {p.cookieDays ? ` · ${p.cookieDays}d cookie` : ""}
                  </span>
                </td>
                <td className="p-3">
                  <StatusBadge status={p.status} />
                </td>
                <td className="p-3">
                  {p.signupUrl ? (
                    <a href={p.signupUrl} target="_blank" rel="noopener" className="text-brand underline">
                      Apply
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-3">
                  {p.status === "found" ? (
                    <form action={setProgramStatusAction}>
                      <input type="hidden" name="programId" value={p.id} />
                      <input type="hidden" name="productId" value={p.productId} />
                      <input type="hidden" name="status" value="applied" />
                      <Button type="submit" size="sm" variant="secondary">
                        Mark applied
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>Nothing in this list.</Empty>
        )
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="font-semibold">By go-link (30 days)</h2>
            <Table head={["Slug", "Clicks", "Fallback"]}>
              {summary.bySlug.map((s) => (
                <tr key={s.slug} className="border-t border-border">
                  <td className="p-3 font-mono">{s.slug}</td>
                  <td className="p-3 tabular-nums">{s.n}</td>
                  <td className="p-3 tabular-nums">{s.fallback}</td>
                </tr>
              ))}
            </Table>
          </section>
          <section>
            <h2 className="font-semibold">By placement (30 days)</h2>
            <Table head={["Placement", "Clicks"]}>
              {summary.byPlacement.map((s) => (
                <tr key={s.placement ?? "none"} className="border-t border-border">
                  <td className="p-3">{s.placement ?? "—"}</td>
                  <td className="p-3 tabular-nums">{s.n}</td>
                </tr>
              ))}
            </Table>
          </section>
          <section className="lg:col-span-2">
            <h2 className="font-semibold">Recent clicks</h2>
            <Table head={["Time", "Slug", "Placement", "Country", "Device", "Bot", "Fallback"]}>
              {clicks.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-3 tabular-nums">{fmtDate(c.ts)}</td>
                  <td className="p-3 font-mono">{c.goSlug}</td>
                  <td className="p-3">{c.placement ?? "—"}</td>
                  <td className="p-3">{c.country ?? "—"}</td>
                  <td className="p-3">{c.device ?? "—"}</td>
                  <td className="p-3">{c.isBot ? "yes" : ""}</td>
                  <td className="p-3">{c.fallback ? "yes" : ""}</td>
                </tr>
              ))}
            </Table>
          </section>
        </div>
      )}
    </div>
  );
}
