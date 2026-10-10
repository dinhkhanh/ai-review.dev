import { listAuditLog } from "@repo/core";
import { getDb } from "@repo/db";
import { requireUser } from "../../../lib/auth";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requireUser({ roles: ["admin"] });
  const rows = await listAuditLog(getDb(), 200);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <div className="overflow-x-auto rounded-lg border border-border bg-bg">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="p-3 font-medium">Time (UTC)</th>
              <th className="p-3 font-medium">Action</th>
              <th className="p-3 font-medium">Actor</th>
              <th className="p-3 font-medium">Entity</th>
              <th className="p-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-3 tabular-nums">{r.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td className="p-3 font-mono">{r.action}</td>
                <td className="p-3 font-mono text-xs">{r.actorUserId ?? "system"}</td>
                <td className="p-3 font-mono text-xs">{r.entityType ? `${r.entityType}:${r.entityId}` : "—"}</td>
                <td className="p-3 font-mono text-xs">{r.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
