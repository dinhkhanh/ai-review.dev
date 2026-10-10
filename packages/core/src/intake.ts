import { DomainError } from "./errors";
import { assertPublicHttpUrl, normalizeWebsiteUrl, registrableDomain } from "./url";

export interface BulkRow {
  line: number;
  url: string;
  name: string | null;
  categorySlug: string | null;
  angle: string | null;
}

export interface BulkParseResult {
  rows: BulkRow[];
  errors: Array<{ line: number; message: string }>;
}

export const BULK_INTAKE_MAX = 100;

/** Splits one CSV line, honouring double quotes ("a, b" stays one field; "" is a quote). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t" || ch === ";") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const looksLikeUrl = (s: string) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s);

/**
 * Bulk intake (FR-INT-2): CSV with a header (url, name, category, angle in any order) or a pasted
 * list with one product per line: "url", "name, url" or "url, name". Rows are validated (public
 * http URL, SSRF guard) and de-duplicated by registrable domain.
 */
export function parseBulkIntake(text: string): BulkParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l, i) => ({ line: i + 1, text: l.trim() }))
    .filter((l) => l.text && !l.text.startsWith("#"));
  const errors: BulkParseResult["errors"] = [];
  const rows: BulkRow[] = [];
  if (lines.length === 0) return { rows, errors };

  const header = splitCsvLine(lines[0]!.text).map((h) => h.toLowerCase());
  const hasHeader = header.includes("url") || header.includes("website");
  const col = (name: string[]) => header.findIndex((h) => name.includes(h));
  const idx = hasHeader
    ? {
        url: col(["url", "website"]),
        name: col(["name", "product"]),
        category: col(["category", "category_slug", "categoryslug"]),
        angle: col(["angle", "audience"]),
      }
    : null;

  const seen = new Set<string>();
  for (const { line, text: raw } of hasHeader ? lines.slice(1) : lines) {
    let cells = splitCsvLine(raw);
    // "cal.com Cal": a pasted line without separators.
    if (!idx && cells.length === 1) cells = raw.split(/\s+/);
    let url: string | undefined;
    let name: string | null;
    let categorySlug: string | null = null;
    let angle: string | null = null;
    if (idx) {
      url = cells[idx.url];
      name = idx.name >= 0 ? cells[idx.name] || null : null;
      categorySlug = idx.category >= 0 ? cells[idx.category]?.toLowerCase() || null : null;
      angle = idx.angle >= 0 ? cells[idx.angle] || null : null;
    } else {
      const urlIndex = cells.findIndex(looksLikeUrl);
      url = urlIndex >= 0 ? cells[urlIndex] : undefined;
      name =
        cells
          .filter((_, i) => i !== urlIndex)
          .join(" ")
          .trim() || null;
    }
    if (!url) {
      errors.push({ line, message: "no URL" });
      continue;
    }
    try {
      const normalized = normalizeWebsiteUrl(url);
      assertPublicHttpUrl(normalized);
      const domain = registrableDomain(normalized);
      if (seen.has(domain)) {
        errors.push({ line, message: `duplicate of an earlier row (${domain})` });
        continue;
      }
      seen.add(domain);
      rows.push({
        line,
        url: normalized,
        name: name?.slice(0, 120) ?? null,
        categorySlug,
        angle: angle?.slice(0, 300) ?? null,
      });
    } catch (error) {
      errors.push({ line, message: error instanceof DomainError ? error.message : "invalid URL" });
    }
    if (rows.length > BULK_INTAKE_MAX) {
      errors.push({ line, message: `only the first ${BULK_INTAKE_MAX} products are accepted per batch` });
      rows.length = BULK_INTAKE_MAX;
      break;
    }
  }
  return { rows, errors };
}
