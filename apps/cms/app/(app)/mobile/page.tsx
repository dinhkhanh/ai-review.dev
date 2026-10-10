import { getSetting, mobileStats } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { Empty, fmtDate, Notice, PageHeader, StatusBadge, Table } from "../../../components/ui";

export const metadata = { title: "Mobile" };

/** Mobile app overview (FR-API-4): installs, price-alert subscriptions and push outcomes. */
export default async function MobilePage() {
  const db = getDb();
  const [stats, push] = await Promise.all([mobileStats(db), getSetting(db, "mobile.push")]);
  const pushOn = push?.priceAlerts ?? true;
  const totalPush = stats.byPlatform.reduce((n, r) => n + r.pushEnabled, 0);
  return (
    <div className="space-y-8">
      <PageHeader
        title="Mobile"
        subtitle="Anonymous app installs, saved items and price-change push alerts. Pushes go out every 15 minutes."
      />
      {!pushOn ? (
        <Notice>
          Price-change pushes are off (<code>mobile.push</code> in Settings).
        </Notice>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          ["Devices", stats.totals.devices],
          ["Push enabled", totalPush],
          ["Saved items", stats.totals.saved],
          ["Price alerts", stats.totals.alerts],
          ["Pending changes", stats.totals.pendingChanges],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-border p-4">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Devices</h2>
        {stats.byPlatform.length === 0 ? (
          <Empty>No app installs yet.</Empty>
        ) : (
          <Table head={["Platform", "Locale", "Devices", "Push enabled", "Active 30 days"]}>
            {stats.byPlatform.map((r) => (
              <tr key={`${r.platform}-${r.locale}`} className="border-t border-border">
                <td className="p-3">{r.platform}</td>
                <td className="p-3">{r.locale}</td>
                <td className="p-3 tabular-nums">{r.devices}</td>
                <td className="p-3 tabular-nums">{r.pushEnabled}</td>
                <td className="p-3 tabular-nums">{r.active30d}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Most-followed products</h2>
        {stats.alertsByProduct.length === 0 ? (
          <Empty>No price alerts yet.</Empty>
        ) : (
          <Table head={["Product", "Followers"]}>
            {stats.alertsByProduct.map((r) => (
              <tr key={r.productId} className="border-t border-border">
                <td className="p-3">
                  <Link href={`/products/${r.productId}`} className="hover:underline">
                    {r.productName}
                  </Link>
                </td>
                <td className="p-3 tabular-nums">{r.alerts}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Price changes</h2>
        <p className="text-sm text-muted">
          Detected by refresh jobs when plan prices change in the fact sheet. Each one is pushed once; devices get at
          most {push?.maxPerDevicePerDay ?? 3} per day.
        </p>
        {stats.recentChanges.length === 0 ? (
          <Empty>No price changes detected yet.</Empty>
        ) : (
          <Table head={["Detected", "Product", "Change", "Push", "Sent", "Failed"]}>
            {stats.recentChanges.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="p-3 tabular-nums">
                  {r.jobId ? (
                    <Link href={`/jobs/${r.jobId}`} className="hover:underline">
                      {fmtDate(r.detectedAt)}
                    </Link>
                  ) : (
                    fmtDate(r.detectedAt)
                  )}
                </td>
                <td className="p-3">
                  <Link href={`/products/${r.productId}`} className="hover:underline">
                    {r.productName}
                  </Link>
                </td>
                <td className="max-w-md p-3">{r.summary}</td>
                <td className="p-3">
                  <StatusBadge status={r.notifiedAt ? "sent" : "pending"} />
                  {r.notifiedAt ? <p className="mt-1 text-xs text-muted">{fmtDate(r.notifiedAt)}</p> : null}
                </td>
                <td className="p-3 tabular-nums">{r.pushSent}</td>
                <td className="p-3 tabular-nums">{r.pushFailed}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
