import {
  configuredConversionNetworks,
  fetchNetworkConversions,
  networkSchema,
  normalizeConversionStatus,
  parseMoney,
  parseSubId,
  type ConversionNetwork,
  type ConversionRow,
  type Network,
} from "@repo/affiliate";
import {
  affiliatePrograms,
  articles,
  conversionImports,
  conversions,
  desc,
  eq,
  inArray,
  products,
  sql,
  type DbOrTx,
} from "@repo/db";
import { notify } from "./notifications";

/** Re-exported so apps can list connectors without depending on @repo/affiliate directly. */
export { CONVERSION_NETWORKS, configuredConversionNetworks, type ConversionNetwork } from "@repo/affiliate";

/** Fields of the common conversion schema a CSV column can map to (FR-AFF-11). */
export const CONVERSION_FIELDS = [
  "date",
  "network",
  "program",
  "subId",
  "orderId",
  "amount",
  "commission",
  "currency",
  "status",
] as const;
export type ConversionField = (typeof CONVERSION_FIELDS)[number];
export type ConversionCsvMapping = Partial<Record<ConversionField, string>>;

/** Detects `,`, `;` or tab from the first line, ignoring delimiters inside quotes. */
function detectDelimiter(firstLine: string): string {
  const counts = new Map<string, number>([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? best[0] : ",";
}

/** RFC 4180-style CSV parser: quoted fields, `""` escapes, newlines in quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(input.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Header patterns, in assignment order (commission before amount, order id before sub id). */
const FIELD_PATTERNS: Array<[ConversionField, RegExp]> = [
  ["commission", /commission|payout|earning|reward/i],
  ["subId", /sub[\s_-]?id|click[\s_-]?ref|^sid$|xcust|cuid|ps_xid|tracking/i],
  ["orderId", /order|transaction|action[\s_-]?id|^id$|reference|conversion[\s_-]?id/i],
  ["amount", /sale|amount|revenue|order[\s_-]?value|total/i],
  ["date", /date|time|occurred|created/i],
  ["program", /program|campaign|advertiser|merchant|brand|offer/i],
  ["currency", /currency/i],
  ["status", /status|state/i],
  ["network", /network/i],
];

/** Guesses which header feeds which field; each header is used at most once. */
export function autoDetectMapping(headers: string[]): ConversionCsvMapping {
  const used = new Set<string>();
  const mapping: ConversionCsvMapping = {};
  for (const [field, pattern] of FIELD_PATTERNS) {
    const header = headers.find((h) => !used.has(h) && pattern.test(h.trim()));
    if (header) {
      mapping[field] = header;
      used.add(header);
    }
  }
  return mapping;
}

/** ISO dates, "2026-10-01 12:00", or d/m/y vs m/d/y (day > 12 decides; otherwise m/d/y). */
export function parseConversionDate(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (dmy) {
    const [a, b, y, h, mi, se] = dmy.slice(1).map((x) => (x === undefined ? 0 : Number(x))) as number[];
    const [day, month] = a! > 12 ? [a!, b!] : [b!, a!];
    const d = new Date(Date.UTC(y!, month - 1, day, h, mi, se));
    return Number.isNaN(d.getTime()) || d.getUTCMonth() !== month - 1 ? null : d;
  }
  const iso = /^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(" ", "T") : s;
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) || !/T/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ParsedConversions {
  headers: string[];
  mapping: ConversionCsvMapping;
  rows: ConversionRow[];
  errors: Array<{ row: number; message: string }>;
}

/**
 * Parses a network CSV export into common rows (FR-AFF-11). Without a mapping the headers are
 * auto-detected. Row numbers in errors are 1-based data rows (header excluded).
 */
export function parseConversionsCsv(
  text: string,
  opts: { mapping?: ConversionCsvMapping; network: Network },
): ParsedConversions {
  const [headerRow, ...data] = parseCsv(text);
  const headers = (headerRow ?? []).map((h) => h.trim());
  const mapping = opts.mapping && Object.keys(opts.mapping).length ? opts.mapping : autoDetectMapping(headers);
  const index = Object.fromEntries(
    Object.entries(mapping).map(([field, header]) => [field, header ? headers.indexOf(header) : -1]),
  ) as Partial<Record<ConversionField, number>>;
  const get = (cells: string[], field: ConversionField) => {
    const i = index[field];
    return i !== undefined && i >= 0 ? (cells[i] ?? "").trim() : "";
  };
  const rows: ConversionRow[] = [];
  const errors: ParsedConversions["errors"] = [];
  data.forEach((cells, i) => {
    const n = i + 1;
    const orderId = get(cells, "orderId");
    const commission = parseMoney(get(cells, "commission"));
    const date = parseConversionDate(get(cells, "date"));
    if (!orderId) return errors.push({ row: n, message: "Missing order id" });
    if (commission === null) return errors.push({ row: n, message: "Missing or invalid commission" });
    if (!date) return errors.push({ row: n, message: `Invalid date "${get(cells, "date")}"` });
    const networkCell = networkSchema.safeParse(get(cells, "network").toLowerCase());
    rows.push({
      date: date.toISOString(),
      network: networkCell.success ? networkCell.data : opts.network,
      program: get(cells, "program") || null,
      subId: get(cells, "subId") || null,
      orderId,
      amount: parseMoney(get(cells, "amount")),
      commission,
      currency: (get(cells, "currency") || "USD").toUpperCase().slice(0, 3),
      status: normalizeConversionStatus(get(cells, "status")),
      raw: Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ""])),
    });
  });
  return { headers, mapping, rows, errors };
}

export interface ImportOptions {
  /** "csv" or "api:<network>". */
  source: string;
  network?: Network | null;
  filename?: string | null;
  userId?: string | null;
  /** Assign every row to this program (CSV exports of a single program). */
  programId?: string | null;
  parseErrors?: Array<{ row: number; message: string }>;
}

/**
 * Stores conversions with attribution (FR-AFF-11, FR-AFF-12): SubID → article + placement,
 * program by explicit id, network + name, or the article's product; upserts on
 * (network, order id) so re-imports update statuses. Rows nobody can attribute are kept and
 * counted as unmatched for manual mapping.
 */
export async function importConversions(db: DbOrTx, rows: ConversionRow[], opts: ImportOptions) {
  const [run] = await db
    .insert(conversionImports)
    .values({
      network: opts.network ?? null,
      source: opts.source,
      filename: opts.filename ?? null,
      rows: rows.length + (opts.parseErrors?.length ?? 0),
      errors: opts.parseErrors ?? [],
      createdByUserId: opts.userId ?? null,
    })
    .returning();
  const programs = await db
    .select({
      id: affiliatePrograms.id,
      network: affiliatePrograms.network,
      name: affiliatePrograms.name,
      productId: affiliatePrograms.productId,
      productName: products.name,
    })
    .from(affiliatePrograms)
    .innerJoin(products, eq(products.id, affiliatePrograms.productId));
  const slugs = [...new Set(rows.map((r) => (r.subId ? parseSubId(r.subId).articleSlug : null)).filter(Boolean))];
  const articleRows = slugs.length
    ? await db
        .select({ id: articles.id, slug: articles.slug, type: articles.type, productId: articles.productId })
        .from(articles)
        .where(inArray(articles.slug, slugs as string[]))
    : [];
  // Reviews first when several article types share a slug.
  const bySlug = new Map<string, (typeof articleRows)[number]>();
  for (const a of [...articleRows].sort((x, y) => (x.type === "review" ? -1 : y.type === "review" ? 1 : 0))) {
    if (!bySlug.has(a.slug)) bySlug.set(a.slug, a);
  }

  let inserted = 0;
  let updated = 0;
  let unmatched = 0;
  const errors = [...(opts.parseErrors ?? [])];
  for (const [i, r] of rows.entries()) {
    try {
      const parsed = r.subId ? parseSubId(r.subId) : { articleSlug: null, placement: null };
      const article = parsed.articleSlug ? (bySlug.get(parsed.articleSlug) ?? null) : null;
      const name = r.program?.trim().toLowerCase() ?? "";
      const program =
        (opts.programId ? programs.find((p) => p.id === opts.programId) : undefined) ??
        (name
          ? programs.find(
              (p) => p.network === r.network && (p.name.toLowerCase() === name || p.productName.toLowerCase() === name),
            )
          : undefined) ??
        (article?.productId
          ? programs.find((p) => p.network === r.network && p.productId === article.productId)
          : undefined) ??
        null;
      const productId = article?.productId ?? program?.productId ?? null;
      if (!article && !productId) unmatched++;
      const values = {
        network: r.network,
        programId: program?.id ?? null,
        subId: r.subId,
        articleId: article?.id ?? null,
        productId,
        placement: parsed.placement,
        importId: run!.id,
        externalOrderId: r.orderId,
        amount: r.amount === null ? null : r.amount.toFixed(2),
        commission: r.commission.toFixed(2),
        currency: r.currency,
        status: r.status,
        occurredAt: new Date(r.date),
        raw: r.raw ?? null,
      };
      const [res] = await db
        .insert(conversions)
        .values(values)
        .onConflictDoUpdate({
          target: [conversions.network, conversions.externalOrderId],
          set: {
            status: values.status,
            amount: values.amount,
            commission: values.commission,
            currency: values.currency,
            importId: values.importId,
            raw: values.raw,
            // Keep earlier attribution when this import can't attribute the row.
            programId: sql`coalesce(${values.programId}::uuid, ${conversions.programId})`,
            articleId: sql`coalesce(${values.articleId}::uuid, ${conversions.articleId})`,
            productId: sql`coalesce(${values.productId}::uuid, ${conversions.productId})`,
            placement: sql`coalesce(${values.placement}, ${conversions.placement})`,
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      if (res?.inserted) inserted++;
      else updated++;
    } catch (error) {
      errors.push({ row: i + 1, message: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    }
  }
  const [done] = await db
    .update(conversionImports)
    .set({ inserted, updated, unmatched, errors: errors.slice(0, 200) })
    .where(eq(conversionImports.id, run!.id))
    .returning();
  if (rows.length) {
    await notify(db, {
      event: "conversions.imported",
      title: `Imported ${rows.length} conversions (${opts.source})`,
      body: `${inserted} new, ${updated} updated, ${unmatched} unattributed, ${errors.length} errors.`,
      href: "/analytics?tab=import",
      entityType: "conversion_import",
      entityId: run!.id,
      dedupeKey: `conversions.imported:${run!.id}`,
    });
  }
  return done!;
}

export async function listConversionImports(db: DbOrTx, limit = 50) {
  return db.select().from(conversionImports).orderBy(desc(conversionImports.createdAt)).limit(Math.min(limit, 200));
}

/**
 * Pulls recent conversions from every configured network API (FR-AFF-11) and imports them.
 * One network failing does not stop the others; failures are returned.
 */
export async function syncNetworkConversions(
  db: DbOrTx,
  opts: {
    from: Date;
    to: Date;
    networks?: ConversionNetwork[];
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
    userId?: string | null;
  },
) {
  const env = opts.env ?? process.env;
  const networks = opts.networks ?? configuredConversionNetworks(env);
  const results: Array<{ network: ConversionNetwork; ok: boolean; rows?: number; importId?: string; error?: string }> =
    [];
  for (const network of networks) {
    try {
      const rows = await fetchNetworkConversions(network, { from: opts.from, to: opts.to }, env, opts.fetch ?? fetch);
      const run = await importConversions(db, rows, { source: `api:${network}`, network, userId: opts.userId });
      results.push({ network, ok: true, rows: rows.length, importId: run.id });
    } catch (error) {
      results.push({ network, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
