import { getJson, normalizeConversionStatus, type ConversionRow, type DateRange, type FetchLike } from "./types";

export interface PartnerStackCredentials {
  apiKey: string;
}

interface PartnerStackReward {
  key?: string;
  amount?: number;
  currency?: string;
  status?: string;
  created_at?: number;
  description?: string;
  company?: { name?: string; key?: string };
  transaction?: { amount?: number; key?: string };
  customer?: { key?: string; meta?: Record<string, unknown> };
  ps_xid?: string;
  meta?: Record<string, unknown>;
}

/**
 * PartnerStack partner rewards (FR-AFF-11). Assumes the partner API v2 rewards list:
 * `GET https://api.partnerstack.com/api/v2/rewards?min_created=<ms>&max_created=<ms>&limit=250`
 * with a bearer partner key, cursor pagination via `starting_after=<last key>` and amounts in cents.
 * Our SubID is sent as `ps_xid` and is read back from the reward, its customer meta, or its meta.
 */
export async function fetchPartnerStackConversions(
  range: DateRange,
  creds: PartnerStackCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<ConversionRow[]> {
  const rows: ConversionRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({
      min_created: String(range.from.getTime()),
      max_created: String(range.to.getTime()),
      limit: "250",
      ...(after ? { starting_after: after } : {}),
    });
    const body = (await getJson(fetchImpl, `https://api.partnerstack.com/api/v2/rewards?${params}`, {
      Authorization: `Bearer ${creds.apiKey}`,
    })) as { data?: { items?: PartnerStackReward[]; has_more?: boolean } };
    const items = body.data?.items ?? [];
    for (const r of items) {
      if (!r.key) continue;
      const xid = r.ps_xid ?? r.customer?.meta?.ps_xid ?? r.meta?.ps_xid;
      rows.push({
        date: new Date(r.created_at ?? Date.now()).toISOString(),
        network: "partnerstack",
        program: r.company?.name ?? r.company?.key ?? null,
        subId: typeof xid === "string" && xid ? xid : null,
        orderId: r.key,
        amount: typeof r.transaction?.amount === "number" ? r.transaction.amount / 100 : null,
        commission: (r.amount ?? 0) / 100,
        currency: (r.currency ?? "USD").toUpperCase(),
        status: normalizeConversionStatus(r.status),
        raw: r as Record<string, unknown>,
      });
    }
    if (!body.data?.has_more || items.length === 0) break;
    after = items[items.length - 1]!.key ?? null;
    if (!after) break;
  }
  return rows;
}
