"use server";

import { networkSchema, type ConversionRow } from "@repo/affiliate";
import {
  CONVERSION_FIELDS,
  configuredConversionNetworks,
  importConversions,
  parseConversionsCsv,
  recordAudit,
  syncNetworkConversions,
  type ConversionCsvMapping,
} from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";
import { triggerTask } from "../../../lib/dispatch";

export type ImportState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "preview";
      version: number;
      headers: string[];
      mapping: ConversionCsvMapping;
      sample: Array<
        Pick<ConversionRow, "date" | "program" | "subId" | "orderId" | "amount" | "commission" | "currency" | "status">
      >;
      total: number;
      errors: Array<{ row: number; message: string }>;
      errorCount: number;
    }
  | { kind: "done"; message: string };

/** CSV conversion import (FR-AFF-11): `intent=preview` parses and shows the mapping; `intent=import` stores. */
export async function conversionCsvAction(prev: ImportState, form: FormData): Promise<ImportState> {
  const user = await requireUser();
  const csv = String(form.get("csv") ?? "");
  if (!csv.trim()) return { kind: "error", message: "Choose a CSV file first." };
  const network = networkSchema.safeParse(form.get("network"));
  if (!network.success) return { kind: "error", message: "Pick the network the export comes from." };
  const mapping: ConversionCsvMapping = {};
  for (const field of CONVERSION_FIELDS) {
    const header = String(form.get(`map_${field}`) ?? "");
    if (header) mapping[field] = header;
  }
  const parsed = parseConversionsCsv(csv, { network: network.data, mapping });
  if (parsed.headers.length === 0) return { kind: "error", message: "The file has no header row." };

  if (form.get("intent") !== "import") {
    return {
      kind: "preview",
      version: prev.kind === "preview" ? prev.version + 1 : 1,
      headers: parsed.headers,
      mapping: parsed.mapping,
      sample: parsed.rows
        .slice(0, 8)
        .map(({ date, program, subId, orderId, amount, commission, currency, status }) => ({
          date,
          program,
          subId,
          orderId,
          amount,
          commission,
          currency,
          status,
        })),
      total: parsed.rows.length,
      errors: parsed.errors.slice(0, 10),
      errorCount: parsed.errors.length,
    };
  }
  if (parsed.rows.length === 0) return { kind: "error", message: "No valid rows to import; check the column mapping." };
  const programId = String(form.get("programId") ?? "") || null;
  const filename = String(form.get("filename") ?? "").slice(0, 200) || null;
  const db = getDb();
  const run = await importConversions(db, parsed.rows, {
    source: "csv",
    network: network.data,
    filename,
    userId: user.id,
    programId,
    parseErrors: parsed.errors,
  });
  await recordAudit(db, {
    actorUserId: user.id,
    action: "conversions.import",
    entityType: "conversion_import",
    entityId: run.id,
    data: { network: network.data, rows: run.rows, filename },
  });
  revalidatePath("/analytics");
  return {
    kind: "done",
    message: `Imported ${parsed.rows.length} rows: ${run.inserted} new, ${run.updated} updated, ${run.unmatched} unattributed, ${run.errors.length} errors.`,
  };
}

export type SyncState = { ok: boolean; message: string } | null;

/** "Sync now" (FR-AFF-11): network API import on the worker, or inline without Trigger.dev. */
export async function syncConversionsNowAction(_prev: SyncState, _form: FormData): Promise<SyncState> {
  const user = await requireUser();
  const networks = configuredConversionNetworks();
  if (networks.length === 0) {
    return { ok: false, message: "No network API credentials are configured (see .env.example, Phase 2)." };
  }
  const db = getDb();
  await recordAudit(db, { actorUserId: user.id, action: "conversions.sync", data: { networks } });
  const run = await triggerTask("sync-conversions-now", { days: 30 });
  if (run.ok) return { ok: true, message: `Sync started on the worker for ${networks.join(", ")}.` };
  const now = new Date();
  const results = await syncNetworkConversions(db, {
    from: new Date(now.getTime() - 30 * 86_400_000),
    to: now,
    networks,
    userId: user.id,
  });
  revalidatePath("/analytics");
  return {
    ok: results.every((r) => r.ok),
    message: results.map((r) => (r.ok ? `${r.network}: ${r.rows} rows` : `${r.network}: ${r.error}`)).join(" · "),
  };
}
