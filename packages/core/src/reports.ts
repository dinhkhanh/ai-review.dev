import { desc, eq, errorReports, type DbOrTx } from "@repo/db";
import { DomainError } from "./errors";

/** Visitor "report a change / error" (FR-WEB-6). Shown to the admin as a refresh task. */
export async function createErrorReport(
  db: DbOrTx,
  input: { articleId?: string | null; productId?: string | null; kind: string; message: string; email?: string | null },
) {
  const message = input.message.trim().slice(0, 2000);
  if (message.length < 5) throw new DomainError("invalid", "Please describe what changed");
  const [row] = await db
    .insert(errorReports)
    .values({
      articleId: input.articleId ?? null,
      productId: input.productId ?? null,
      kind: input.kind.slice(0, 40),
      message,
      email: input.email?.trim().slice(0, 200) || null,
    })
    .returning();
  return row!;
}

export async function listErrorReports(db: DbOrTx, opts: { status?: "open" | "resolved" | "dismissed" } = {}) {
  return db
    .select()
    .from(errorReports)
    .where(opts.status ? eq(errorReports.status, opts.status) : undefined)
    .orderBy(desc(errorReports.createdAt))
    .limit(200);
}

export async function setErrorReportStatus(db: DbOrTx, id: string, status: "open" | "resolved" | "dismissed") {
  await db.update(errorReports).set({ status }).where(eq(errorReports.id, id));
}
