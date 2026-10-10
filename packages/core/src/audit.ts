import { auditLog, type DbOrTx } from "@repo/db";

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  ip?: string | null;
}

/** Append-only admin audit trail (FR-CMS-1). */
export async function recordAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    data: entry.data,
    ip: entry.ip ?? null,
  });
}
