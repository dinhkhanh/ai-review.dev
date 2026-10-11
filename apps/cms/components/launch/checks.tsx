import type { CheckItem, CheckStatus } from "@repo/core";
import { Badge } from "@repo/ui/badge";

const TONE: Record<CheckStatus, "success" | "danger" | "warning" | "neutral"> = {
  pass: "success",
  fail: "danger",
  warn: "warning",
  "n/a": "neutral",
};

const RANK: Record<CheckStatus, number> = { fail: 3, warn: 2, pass: 1, "n/a": 0 };

/** Worst status of a group: fail > warn > pass > n/a. */
export function worstStatus(items: Array<{ status: CheckStatus }>): CheckStatus {
  return items.reduce<CheckStatus>((worst, i) => (RANK[i.status] > RANK[worst] ? i.status : worst), "n/a");
}

export function StatusChip({ status, label }: { status: CheckStatus; label?: string }) {
  return (
    <Badge tone={TONE[status]} title={status}>
      {label ? `${label} · ${status}` : status}
    </Badge>
  );
}

/** One check per row: status, label, detail, and its evidence behind a disclosure. */
export function CheckList({ items }: { items: CheckItem[] }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 py-2 text-sm">
          <span className="w-12 shrink-0 pt-0.5">
            <StatusChip status={item.status} />
          </span>
          <div className="min-w-0">
            <p className="font-medium">{item.label}</p>
            <p className="text-muted">{item.detail}</p>
            {item.evidence && Object.keys(item.evidence).length ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-muted">Evidence</summary>
                <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface p-2 text-xs">
                  {JSON.stringify(item.evidence, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
