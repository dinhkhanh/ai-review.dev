import { Badge } from "@repo/ui/badge";
import Link from "next/link";
import type { ReactNode } from "react";

export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export const usd4 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 16).replace("T", " ");
}

export function duration(start: Date | null, end: Date | null) {
  if (!start) return "—";
  const ms = (end ?? new Date()).getTime() - start.getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const TONES: Record<string, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  succeeded: "success",
  published: "success",
  active: "success",
  approved: "success",
  supported: "success",
  running: "brand",
  in_review: "brand",
  scheduled: "brand",
  queued: "neutral",
  draft: "neutral",
  pending: "neutral",
  found: "brand",
  applied: "warning",
  awaiting_approval: "warning",
  changes_requested: "warning",
  stale: "warning",
  blocked: "warning",
  in_progress: "brand",
  current: "success",
  sent: "success",
  sending: "brand",
  missing: "neutral",
  paused: "warning",
  outdated: "warning",
  uncited: "warning",
  failed: "danger",
  broken: "danger",
  rejected: "danger",
  unsupported: "danger",
  cancelled: "neutral",
  archived: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
}: {
  tabs: Array<{ key: string; label: string; href: string; count?: number }>;
  active: string;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Tabs">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.key === active ? "border-brand font-medium" : "border-transparent text-muted hover:text-text"}`}
        >
          {t.label}
          {typeof t.count === "number" ? <span className="ml-1.5 text-xs text-muted">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function JsonView({ value, label = "JSON" }: { value: unknown; label?: string }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted">{label}</summary>
      <pre className="mt-1 max-h-96 overflow-auto rounded bg-surface p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg">
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="p-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">{children}</p>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "bg-danger/10 text-danger"
      : tone === "success"
        ? "bg-success/10 text-success"
        : "bg-brand/10 text-text";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-md px-3 py-2 text-sm ${cls}`}>
      {children}
    </p>
  );
}
