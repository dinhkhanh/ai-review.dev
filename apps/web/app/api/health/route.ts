import { getDb, sql } from "@repo/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok", db: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "degraded", db: "error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
