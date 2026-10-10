"use client";

import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/input";
import { useActionState, useState } from "react";
import { Notice } from "../../../components/ui";
import { conversionCsvAction, type ImportState } from "./actions";

const FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: "orderId", label: "Order / transaction id", required: true },
  { key: "date", label: "Date", required: true },
  { key: "commission", label: "Commission", required: true },
  { key: "subId", label: "SubID / click ref" },
  { key: "program", label: "Program / advertiser" },
  { key: "amount", label: "Sale amount" },
  { key: "currency", label: "Currency" },
  { key: "status", label: "Status" },
  { key: "network", label: "Network (per row)" },
];

// Server actions accept up to 1 MB; larger exports should be split by date.
const MAX_CHARS = 900_000;

const selectCls = "h-10 w-full rounded-md border border-border bg-bg px-3 text-sm";

/** Upload → mapping preview → import, for network CSV exports (FR-AFF-11). */
export function ConversionImport({
  networks,
  programs,
}: {
  networks: readonly string[];
  programs: Array<{ id: string; label: string }>;
}) {
  const [state, action, pending] = useActionState<ImportState, FormData>(conversionCsvAction, { kind: "idle" });
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    const text = await file.text();
    if (text.length > MAX_CHARS) {
      setCsv("");
      setFileError("File is larger than ~900 KB; export a shorter date range and import it in parts.");
      return;
    }
    setCsv(text);
    setFilename(file.name);
  }

  const preview = state.kind === "preview" ? state : null;
  return (
    <form action={action} className="space-y-4">
      <textarea name="csv" value={csv} readOnly hidden />
      <input type="hidden" name="filename" value={filename} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="csv-file">CSV export</Label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block w-full text-sm"
          />
        </div>
        <div>
          <Label htmlFor="network">Network</Label>
          <select id="network" name="network" defaultValue="partnerstack" className={selectCls}>
            {networks.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="programId">Assign every row to a program (optional)</Label>
          <select id="programId" name="programId" defaultValue="" className={selectCls}>
            <option value="">Match by name / SubID</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {fileError ? <Notice tone="error">{fileError}</Notice> : null}

      {preview ? (
        <div className="space-y-3" key={preview.version}>
          <p className="text-sm font-medium">Column mapping</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <Label htmlFor={`map_${f.key}`}>
                  {f.label}
                  {f.required ? " *" : ""}
                </Label>
                <select
                  id={`map_${f.key}`}
                  name={`map_${f.key}`}
                  defaultValue={preview.mapping[f.key as keyof typeof preview.mapping] ?? ""}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted">
            {preview.total} valid rows, {preview.errorCount} skipped. First rows after mapping:
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="text-left text-muted">
                <tr>
                  {["Date", "Order", "Program", "SubID", "Sale", "Commission", "Status"].map((h) => (
                    <th key={h} className="p-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r) => (
                  <tr key={r.orderId} className="border-t border-border">
                    <td className="p-2 tabular-nums">{r.date.slice(0, 10)}</td>
                    <td className="p-2 font-mono">{r.orderId}</td>
                    <td className="p-2">{r.program ?? "—"}</td>
                    <td className="p-2 font-mono">{r.subId ?? "—"}</td>
                    <td className="p-2 tabular-nums">{r.amount ?? "—"}</td>
                    <td className="p-2 tabular-nums">
                      {r.commission} {r.currency}
                    </td>
                    <td className="p-2">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.errors.length ? (
            <ul className="list-inside list-disc text-xs text-danger">
              {preview.errors.map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="preview" variant="secondary" disabled={!csv || pending}>
          {preview ? "Update preview" : "Preview"}
        </Button>
        {preview ? (
          <Button type="submit" name="intent" value="import" disabled={!csv || pending || preview.total === 0}>
            {pending ? "Working…" : `Import ${preview.total} rows`}
          </Button>
        ) : null}
      </div>
      {state.kind === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      {state.kind === "done" ? <Notice tone="success">{state.message}</Notice> : null}
    </form>
  );
}
