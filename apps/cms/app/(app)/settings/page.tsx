import { asc, getDb, settings } from "@repo/db";
import { Card } from "@repo/ui/card";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const rows = await getDb().select().from(settings).orderBy(asc(settings.key));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Read-only in Phase 0. Defaults come from the owner decisions in docs/srs.md §9.
        </p>
      </div>
      <Card className="p-0">
        <dl className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.key} className="grid gap-1 p-4 sm:grid-cols-3">
              <dt className="font-mono text-sm">{r.key}</dt>
              <dd className="font-mono text-sm text-muted sm:col-span-2">{JSON.stringify(r.value)}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
