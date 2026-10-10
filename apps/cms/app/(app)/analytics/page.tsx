import { KNOWN_NETWORKS } from "@repo/affiliate";
import {
  analyticsTotals,
  articleFunnel,
  articleMargins,
  CONVERSION_NETWORKS,
  configuredConversionNetworks,
  costsBy,
  listConversionImports,
  listPrograms,
  parseDateRange,
  placementCtr,
  revenueBy,
} from "@repo/core";
import { getDb } from "@repo/db";
import { Button } from "@repo/ui/button";
import { Input, Label } from "@repo/ui/input";
import Link from "next/link";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { Empty, fmtDate, PageHeader, StatusBadge, Table, Tabs, usd, usd4 } from "../../../components/ui";
import { syncConversionsNowAction } from "./actions";
import { ConversionImport } from "./conversion-import";

export const metadata = { title: "Analytics" };

const TABS = ["revenue", "funnel", "costs", "import"] as const;
type Tab = (typeof TABS)[number];
const BY = ["month", "article", "product", "placement"] as const;
type By = (typeof BY)[number];

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`);
const money = (v: number | null) => (v === null ? "—" : usd.format(v));
const day = (d: Date) => d.toISOString().slice(0, 10);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Revenue attribution, funnels, costs and imports/exports (FR-AFF-11, FR-AFF-12, FR-ANL-2,
 * FR-ANL-3, FR-ANL-4). Revenue = commission on approved or paid conversions; clicks are humans only.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; by?: string }>;
}) {
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "revenue";
  const by: By = (BY as readonly string[]).includes(sp.by ?? "") ? (sp.by as By) : "month";
  const range = parseDateRange(sp.from, sp.to);
  const from = day(range.from);
  const to = day(new Date(range.to.getTime() - 86_400_000));
  const qs = (extra: Record<string, string>) => `?${new URLSearchParams({ from, to, ...extra })}`;
  const db = getDb();
  const totals = await analyticsTotals(db, range);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Clicks, conversions, revenue and AI spend. Conversions arrive by CSV upload or the daily network sync."
      />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="by" value={by} />
        <div>
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Pageviews" value={totals.pageviews.toLocaleString("en-US")} />
        <Stat label="CTA clicks" value={totals.clicks.toLocaleString("en-US")} />
        <Stat label="Conversions" value={totals.conversions.toLocaleString("en-US")} />
        <Stat label="Revenue" value={usd.format(totals.revenueUsd)} />
        <Stat label="Pending" value={usd.format(totals.pendingUsd)} />
        <Stat label="EPC" value={money(totals.epc)} />
        <Stat label="AI/API spend" value={usd.format(totals.costUsd)} />
      </div>
      <Tabs
        active={tab}
        tabs={[
          { key: "revenue", label: "Revenue", href: `/analytics${qs({ tab: "revenue", by })}` },
          { key: "funnel", label: "Funnel", href: `/analytics${qs({ tab: "funnel" })}` },
          { key: "costs", label: "Costs", href: `/analytics${qs({ tab: "costs" })}` },
          { key: "import", label: "Import & export", href: `/analytics${qs({ tab: "import" })}` },
        ]}
      />
      {tab === "revenue" ? <RevenueTab range={range} by={by} qs={qs} /> : null}
      {tab === "funnel" ? <FunnelTab range={range} /> : null}
      {tab === "costs" ? <CostsTab range={range} /> : null}
      {tab === "import" ? <ImportTab from={from} to={to} /> : null}
    </div>
  );
}

async function RevenueTab({
  range,
  by,
  qs,
}: {
  range: { from: Date; to: Date };
  by: By;
  qs: (extra: Record<string, string>) => string;
}) {
  const rows = await revenueBy(getDb(), by, range);
  const labelFor = (r: (typeof rows)[number]) => {
    if (by === "article" && r.key)
      return (
        <Link href={`/articles/${r.key}`} className="hover:underline">
          {r.label ?? r.key}
        </Link>
      );
    if (by === "product" && r.key)
      return (
        <Link href={`/products/${r.key}`} className="hover:underline">
          {r.label ?? r.key}
        </Link>
      );
    return r.label ?? r.key ?? <span className="text-muted">unattributed</span>;
  };
  return (
    <section className="space-y-4">
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Group by">
        {BY.map((b) => (
          <Link
            key={b}
            href={`/analytics${qs({ tab: "revenue", by: b })}`}
            aria-current={b === by ? "page" : undefined}
            className={`rounded-md px-3 py-1 ${b === by ? "bg-brand text-brand-fg" : "bg-surface hover:bg-border/60"}`}
          >
            By {b}
          </Link>
        ))}
      </nav>
      {rows.length ? (
        <Table
          head={[
            by[0]!.toUpperCase() + by.slice(1),
            "Clicks",
            "Conversions",
            "Conv. rate",
            "Revenue",
            "Pending",
            "EPC",
          ]}
        >
          {rows.map((r) => (
            <tr key={r.key ?? "none"} className="border-t border-border">
              <td className="p-3">{labelFor(r)}</td>
              <td className="p-3 tabular-nums">{r.clicks}</td>
              <td className="p-3 tabular-nums">{r.conversions}</td>
              <td className="p-3 tabular-nums">{pct(r.conversionRate)}</td>
              <td className="p-3 tabular-nums">{usd.format(r.revenueUsd)}</td>
              <td className="p-3 tabular-nums">{usd.format(r.pendingUsd)}</td>
              <td className="p-3 tabular-nums">{money(r.epc)}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>No clicks or conversions in this range.</Empty>
      )}
    </section>
  );
}

async function FunnelTab({ range }: { range: { from: Date; to: Date } }) {
  const db = getDb();
  const [rows, placements] = await Promise.all([articleFunnel(db, range), placementCtr(db, range)]);
  return (
    <div className="space-y-8">
      {placements.pageviews === 0 ? (
        <p className="rounded-md bg-surface px-3 py-2 text-sm text-muted">
          No page views imported for this range. They come from Plausible daily once PLAUSIBLE_API_KEY and
          NEXT_PUBLIC_PLAUSIBLE_DOMAIN are set on the worker.
        </p>
      ) : null}
      <section className="space-y-3">
        <h2 className="font-semibold">Per article: views → CTA clicks → conversions → commission</h2>
        {rows.length ? (
          <Table head={["Article", "Views", "CTA clicks", "CTR", "Conversions", "Conv. rate", "Revenue"]}>
            {rows.map((r) => (
              <tr key={r.articleId} className="border-t border-border">
                <td className="p-3">
                  <Link href={`/articles/${r.articleId}`} className="hover:underline">
                    {r.title}
                  </Link>
                  <span className="ml-2 text-xs text-muted">{r.type.replace("_", " ")}</span>
                </td>
                <td className="p-3 tabular-nums">{r.pageviews}</td>
                <td className="p-3 tabular-nums">{r.clicks}</td>
                <td className="p-3 tabular-nums">{pct(r.ctr)}</td>
                <td className="p-3 tabular-nums">{r.conversions}</td>
                <td className="p-3 tabular-nums">{pct(r.conversionRate)}</td>
                <td className="p-3 tabular-nums">{usd.format(r.revenueUsd)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No article activity in this range.</Empty>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">CTR per placement</h2>
        {placements.placements.length ? (
          <Table head={["Placement", "Clicks", "CTR (per article view)", "Conversions", "Revenue", "EPC"]}>
            {placements.placements.map((p) => (
              <tr key={p.placement} className="border-t border-border">
                <td className="p-3 font-mono">{p.placement}</td>
                <td className="p-3 tabular-nums">{p.clicks}</td>
                <td className="p-3 tabular-nums">{pct(p.ctr)}</td>
                <td className="p-3 tabular-nums">{p.conversions}</td>
                <td className="p-3 tabular-nums">{usd.format(p.revenueUsd)}</td>
                <td className="p-3 tabular-nums">{money(p.epc)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No clicks in this range.</Empty>
        )}
      </section>
    </div>
  );
}

async function CostsTab({ range }: { range: { from: Date; to: Date } }) {
  const db = getDb();
  const [bySteps, byModel, byMonth, margins] = await Promise.all([
    costsBy(db, "step", range),
    costsBy(db, "model", range),
    costsBy(db, "month", range),
    articleMargins(db),
  ]);
  const costTable = (title: string, rows: typeof bySteps) => (
    <section className="space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {rows.length ? (
        <Table head={["", "Calls", "Cost"]}>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="p-3 font-mono text-xs">{r.key}</td>
              <td className="p-3 tabular-nums">{r.calls}</td>
              <td className="p-3 tabular-nums">{usd4.format(r.costUsd)}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>No spend in this range.</Empty>
      )}
    </section>
  );
  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-3">
        {costTable("By step", bySteps)}
        {costTable("By model", byModel)}
        {costTable("By month", byMonth)}
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">Margin per article (lifetime)</h2>
        <p className="text-sm text-muted">
          {margins.publishedArticles} published articles · average pipeline cost{" "}
          {usd.format(margins.costPerPublishedArticleUsd)} per published article.
        </p>
        {margins.margins.length ? (
          <Table head={["Article", "Status", "Cost", "Revenue", "Pending", "Margin"]}>
            {margins.margins.map((m) => (
              <tr key={m.articleId} className="border-t border-border">
                <td className="p-3">
                  <Link href={`/articles/${m.articleId}`} className="hover:underline">
                    {m.title}
                  </Link>
                </td>
                <td className="p-3">
                  <StatusBadge status={m.status} />
                </td>
                <td className="p-3 tabular-nums">{usd.format(m.costUsd)}</td>
                <td className="p-3 tabular-nums">{usd.format(m.revenueUsd)}</td>
                <td className="p-3 tabular-nums">{usd.format(m.pendingUsd)}</td>
                <td className={`p-3 tabular-nums ${m.marginUsd < 0 ? "text-danger" : "text-success"}`}>
                  {usd.format(m.marginUsd)}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No article costs yet.</Empty>
        )}
      </section>
    </div>
  );
}

async function ImportTab({ from, to }: { from: string; to: string }) {
  const db = getDb();
  const [imports, programs] = await Promise.all([listConversionImports(db), listPrograms(db)]);
  const configured = configuredConversionNetworks();
  const exportHref = (kind: string) => `/api/export/${kind}?${new URLSearchParams({ from, to })}`;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-semibold">Upload a network CSV</h2>
        <p className="max-w-3xl text-sm text-muted">
          Any network&apos;s conversion export works: map its columns once in the preview. SubIDs (
          <code>article-slug--placement</code>) attribute each sale to an article and placement; re-importing updates
          statuses by order id.
        </p>
        <ConversionImport
          networks={KNOWN_NETWORKS}
          programs={programs.map(({ program, productName }) => ({
            id: program.id,
            label: `${productName} — ${program.name} (${program.network})`,
          }))}
        />
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Network APIs</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {CONVERSION_NETWORKS.map((n) => (
            <li key={n} className="rounded-md border border-border px-3 py-1">
              {n}: {configured.includes(n) ? "configured" : <span className="text-muted">no credentials</span>}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">The worker imports the last 30 days from configured networks every day.</p>
        <ActionForm action={syncConversionsNowAction}>
          <SubmitButton size="sm" variant="secondary" pendingLabel="Syncing…" disabled={configured.length === 0}>
            Sync now
          </SubmitButton>
        </ActionForm>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">
          Export CSV ({from} to {to})
        </h2>
        <div className="flex flex-wrap gap-2">
          {(["clicks", "conversions", "costs"] as const).map((k) => (
            <a
              key={k}
              href={exportHref(k)}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-border/60"
              download
            >
              {k[0]!.toUpperCase() + k.slice(1)}.csv
            </a>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Import history</h2>
        {imports.length ? (
          <Table head={["When", "Source", "File", "Rows", "New", "Updated", "Unattributed", "Errors"]}>
            {imports.map((i) => (
              <tr key={i.id} className="border-t border-border align-top">
                <td className="p-3 tabular-nums">{fmtDate(i.createdAt)}</td>
                <td className="p-3">
                  {i.source}
                  {i.network ? <span className="ml-1 text-xs text-muted">{i.network}</span> : null}
                </td>
                <td className="p-3">{i.filename ?? "—"}</td>
                <td className="p-3 tabular-nums">{i.rows}</td>
                <td className="p-3 tabular-nums">{i.inserted}</td>
                <td className="p-3 tabular-nums">{i.updated}</td>
                <td className="p-3 tabular-nums">{i.unmatched}</td>
                <td className="p-3 text-xs">
                  {i.errors.length ? (
                    <details>
                      <summary className="cursor-pointer text-danger">{i.errors.length}</summary>
                      <ul className="mt-1 space-y-0.5">
                        {i.errors.slice(0, 20).map((e) => (
                          <li key={`${e.row}-${e.message}`}>
                            Row {e.row}: {e.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    0
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No imports yet.</Empty>
        )}
      </section>
    </div>
  );
}
