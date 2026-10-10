import { getJson, normalizeConversionStatus, type ConversionRow, type DateRange, type FetchLike } from "./types";

export interface AwinCredentials {
  apiToken: string;
  publisherId: string;
}

interface AwinTransaction {
  id?: number | string;
  advertiserId?: number | string;
  advertiserName?: string;
  commissionStatus?: string;
  paidToPublisher?: boolean;
  saleAmount?: { amount?: number; currency?: string };
  commissionAmount?: { amount?: number; currency?: string };
  transactionDate?: string;
  clickRefs?: { clickRef?: string | null } | null;
}

const DAY = 24 * 3600 * 1000;

/**
 * Awin publisher transactions (FR-AFF-11): `GET /publishers/{id}/transactions/` with a bearer
 * token, at most 31 days per request (we page through the range in 30-day windows). Our SubID is
 * sent as `clickref` and comes back in `clickRefs.clickRef`. The program is the advertiser id
 * (`awin:<advertiserId>`) unless the response names it.
 */
export async function fetchAwinConversions(
  range: DateRange,
  creds: AwinCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<ConversionRow[]> {
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const rows: ConversionRow[] = [];
  for (let start = range.from.getTime(); start < range.to.getTime(); start += 30 * DAY) {
    const end = Math.min(start + 30 * DAY, range.to.getTime());
    const params = new URLSearchParams({
      startDate: fmt(new Date(start)),
      endDate: fmt(new Date(end)),
      timezone: "UTC",
    });
    const list = (await getJson(
      fetchImpl,
      `https://api.awin.com/publishers/${encodeURIComponent(creds.publisherId)}/transactions/?${params}`,
      { Authorization: `Bearer ${creds.apiToken}` },
    )) as AwinTransaction[];
    for (const t of Array.isArray(list) ? list : []) {
      if (t.id === undefined || t.id === null) continue;
      rows.push({
        date: new Date(t.transactionDate ?? Date.now()).toISOString(),
        network: "awin",
        program: t.advertiserName ?? (t.advertiserId !== undefined ? `awin:${t.advertiserId}` : null),
        subId: t.clickRefs?.clickRef || null,
        orderId: String(t.id),
        amount: t.saleAmount?.amount ?? null,
        commission: t.commissionAmount?.amount ?? 0,
        currency: (t.commissionAmount?.currency ?? t.saleAmount?.currency ?? "GBP").toUpperCase(),
        status: t.paidToPublisher ? "paid" : normalizeConversionStatus(t.commissionStatus),
        raw: t as Record<string, unknown>,
      });
    }
  }
  return rows;
}
