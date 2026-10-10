import { factSheetSchema, type FactSheet } from "@repo/content";
import { and, desc, eq, factSheets, sql, type DbOrTx } from "@repo/db";

export interface FactChange {
  path: string;
  before: unknown;
  after: unknown;
}

/** Strips provenance so diffs show value changes only. */
function valuesOnly(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(valuesOnly);
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if ("value" in obj && "citations" in obj) return valuesOnly(obj.value);
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([k]) => k !== "citations" && k !== "confidence" && k !== "observedAt")
        .map(([k, v]) => [k, valuesOnly(v)]),
    );
  }
  return input;
}

function flatten(input: unknown, prefix: string, out: Map<string, unknown>) {
  if (Array.isArray(input)) {
    // Arrays of scalars compare as a whole; arrays of objects compare per index.
    if (input.every((v) => v === null || typeof v !== "object")) out.set(prefix, input);
    else input.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    if (input.length === 0) out.set(prefix, []);
    return;
  }
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out.set(prefix, input);
}

/** Field-level diff between two fact sheets, ignoring citations (FR-RES-9, acceptance criterion 6). */
export function diffFactSheets(before: FactSheet | null, after: FactSheet): FactChange[] {
  if (!before) return [];
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten(valuesOnly(before), "", a);
  flatten(valuesOnly(after), "", b);
  const changes: FactChange[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key);
    const y = b.get(key);
    if (JSON.stringify(x) !== JSON.stringify(y)) changes.push({ path: key, before: x ?? null, after: y ?? null });
  }
  return changes.sort((p, q) => p.path.localeCompare(q.path));
}

export async function latestFactSheet(db: DbOrTx, productId: string) {
  const [row] = await db
    .select()
    .from(factSheets)
    .where(eq(factSheets.productId, productId))
    .orderBy(desc(factSheets.version))
    .limit(1);
  return row ?? null;
}

export async function listFactSheetVersions(db: DbOrTx, productId: string) {
  return db
    .select({
      id: factSheets.id,
      version: factSheets.version,
      createdAt: factSheets.createdAt,
      createdByJobId: factSheets.createdByJobId,
      editedByUserId: factSheets.editedByUserId,
      changes: sql<number>`coalesce(jsonb_array_length(${factSheets.diffFromPrevious}), 0)::int`,
    })
    .from(factSheets)
    .where(eq(factSheets.productId, productId))
    .orderBy(desc(factSheets.version));
}

export async function getFactSheetVersion(db: DbOrTx, productId: string, version: number) {
  const [row] = await db
    .select()
    .from(factSheets)
    .where(and(eq(factSheets.productId, productId), eq(factSheets.version, version)))
    .limit(1);
  return row ?? null;
}

/** Saves a new fact sheet version with its diff against the previous one. Fact sheets are immutable. */
export async function saveFactSheet(
  db: DbOrTx,
  productId: string,
  data: FactSheet,
  by: { jobId?: string | null; userId?: string | null } = {},
) {
  const parsed = factSheetSchema.parse(data);
  return db.transaction(async (tx) => {
    const prev = await latestFactSheet(tx, productId);
    const [row] = await tx
      .insert(factSheets)
      .values({
        productId,
        version: (prev?.version ?? 0) + 1,
        data: parsed,
        diffFromPrevious: diffFactSheets(prev?.data ?? null, parsed),
        createdByJobId: by.jobId ?? null,
        editedByUserId: by.userId ?? null,
      })
      .returning();
    return row!;
  });
}

/** Share of pricing fields that carry at least one citation (acceptance criterion 1: ≥ 90 %). */
export function pricingCitationCoverage(sheet: FactSheet): number {
  const p = sheet.pricing;
  if (!p) return 0;
  const fields = [p.tiers, p.freePlan, p.freeTrialDays, p.moneyBackDays].filter(Boolean);
  if (fields.length === 0) return 0;
  return fields.filter((f) => f!.citations.length > 0).length / fields.length;
}
