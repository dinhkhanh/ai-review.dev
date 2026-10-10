import { and, desc, eq, promptTemplates, sql, type DbOrTx } from "@repo/db";
import { DomainError } from "./errors";

/**
 * CMS prompt edits (FR-CMS-7, C-5). The repo holds default prompts; an active DB row overrides the
 * body for one key. Versions are numbered from 1001 so they never collide with repo versions.
 */
export async function getActivePromptOverride(db: DbOrTx, key: string) {
  const [row] = await db
    .select()
    .from(promptTemplates)
    .where(and(eq(promptTemplates.key, key), eq(promptTemplates.active, true)))
    .limit(1);
  return row ?? null;
}

export async function listPromptVersions(db: DbOrTx, key: string) {
  return db.select().from(promptTemplates).where(eq(promptTemplates.key, key)).orderBy(desc(promptTemplates.version));
}

export async function savePromptVersion(
  db: DbOrTx,
  input: { key: string; body: string; notes?: string | null; userId?: string | null; activate?: boolean },
) {
  if (!input.body.trim()) throw new DomainError("invalid", "Prompt body is empty");
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ v: sql<number>`max(${promptTemplates.version})` })
      .from(promptTemplates)
      .where(eq(promptTemplates.key, input.key));
    const version = Math.max(1000, Number(last?.v ?? 0)) + 1;
    if (input.activate) {
      await tx.update(promptTemplates).set({ active: false }).where(eq(promptTemplates.key, input.key));
    }
    const [row] = await tx
      .insert(promptTemplates)
      .values({
        key: input.key,
        version,
        body: input.body,
        notes: input.notes ?? null,
        createdByUserId: input.userId ?? null,
        active: input.activate ?? false,
      })
      .returning();
    return row!;
  });
}

/** Activates one override version, or with `version: null` reverts the key to the repo default. */
export async function activatePromptVersion(db: DbOrTx, key: string, version: number | null) {
  await db.transaction(async (tx) => {
    await tx.update(promptTemplates).set({ active: false }).where(eq(promptTemplates.key, key));
    if (version !== null) {
      const [row] = await tx
        .update(promptTemplates)
        .set({ active: true })
        .where(and(eq(promptTemplates.key, key), eq(promptTemplates.version, version)))
        .returning();
      if (!row) throw new DomainError("not_found", `Prompt ${key} v${version} not found`);
    }
  });
}
