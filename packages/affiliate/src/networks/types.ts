import type { Network } from "../index";

/** Conversion statuses we store (FR-AFF-11); networks' own vocabularies map onto these. */
export type ConversionStatus = "pending" | "approved" | "reversed" | "paid";

/**
 * Common conversion row (FR-AFF-11): what a CSV upload or a network reporting API produces before
 * attribution. Amounts are in `currency` major units (e.g. 12.5 = $12.50).
 */
export interface ConversionRow {
  /** ISO timestamp of the sale or lead. */
  date: string;
  network: Network;
  /** Program (campaign/advertiser) name or network id, used to match an affiliate program. */
  program: string | null;
  /** Our SubID (`<article-slug>--<placement>`), when the network passed it back. */
  subId: string | null;
  orderId: string;
  amount: number | null;
  commission: number;
  currency: string;
  status: ConversionStatus;
  raw?: Record<string, unknown>;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export type FetchLike = typeof fetch;

/** Maps a network's status word onto ours; unknown words count as pending. */
export function normalizeConversionStatus(input: string | null | undefined): ConversionStatus {
  const s = (input ?? "").trim().toLowerCase();
  if (/(paid|payout|locked)/.test(s)) return "paid";
  if (/(reverse|declin|reject|deleted|void|refund|cancel)/.test(s)) return "reversed";
  if (/(approv|confirm|accept|valid)/.test(s)) return "approved";
  return "pending";
}

/** Parses "12.5", "$1,234.50", "1.234,50" or a number into a float; null when absent. */
export function parseMoney(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  let s = input.replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(
      `${new URL(url).hostname} responded ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
    );
  return res.json();
}
