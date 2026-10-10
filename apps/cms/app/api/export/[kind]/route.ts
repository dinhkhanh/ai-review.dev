import { EXPORT_KINDS, exportRows, parseDateRange, recordAudit, toCsv, type ExportKind } from "@repo/core";
import { getDb } from "@repo/db";
import type { NextRequest } from "next/server";
import { getSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

/**
 * CSV export of clicks, conversions or costs for a date range (FR-ANL-4). Same checks as the CMS
 * pages (signed in, 2FA enrolled, not banned); answers 401 instead of redirecting.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session || !session.user.twoFactorEnabled || session.user.banned) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new Response("Unknown export", { status: 404 });
  const range = parseDateRange(request.nextUrl.searchParams.get("from"), request.nextUrl.searchParams.get("to"));
  const db = getDb();
  const { columns, rows } = await exportRows(db, kind as ExportKind, range);
  const from = range.from.toISOString().slice(0, 10);
  const to = new Date(range.to.getTime() - 86_400_000).toISOString().slice(0, 10);
  await recordAudit(db, {
    actorUserId: session.user.id,
    action: `export.${kind}`,
    data: { from, to, rows: rows.length },
  });
  return new Response(toCsv(rows, columns), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
