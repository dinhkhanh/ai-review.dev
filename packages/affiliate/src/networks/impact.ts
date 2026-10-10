import {
  getJson,
  normalizeConversionStatus,
  parseMoney,
  type ConversionRow,
  type DateRange,
  type FetchLike,
} from "./types";

export interface ImpactCredentials {
  accountSid: string;
  authToken: string;
}

interface ImpactAction {
  Id?: string;
  CampaignName?: string;
  CampaignId?: string;
  State?: string;
  Amount?: string | number;
  Payout?: string | number;
  Currency?: string;
  EventDate?: string;
  SubId1?: string;
}

/**
 * Impact.com partner reporting (FR-AFF-11): `GET /Mediapartners/{AccountSID}/Actions` with HTTP
 * basic auth (AccountSID:AuthToken), JSON, paginated through `@nextpageuri`. Our SubID goes out in
 * `subId1` (see NETWORK_SUBID_PARAMS) and comes back as `SubId1`. Impact caps a query at 45 days,
 * so callers sync recent windows.
 */
export async function fetchImpactConversions(
  range: DateRange,
  creds: ImpactCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<ConversionRow[]> {
  const auth = `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`;
  const base = "https://api.impact.com";
  const params = new URLSearchParams({
    ActionDateStart: range.from.toISOString().replace(/\.\d{3}Z$/, "Z"),
    ActionDateEnd: range.to.toISOString().replace(/\.\d{3}Z$/, "Z"),
    PageSize: "1000",
  });
  let next: string | null = `/Mediapartners/${encodeURIComponent(creds.accountSid)}/Actions?${params}`;
  const rows: ConversionRow[] = [];
  for (let page = 0; next && page < 50; page++) {
    const body = (await getJson(fetchImpl, `${base}${next}`, { Authorization: auth })) as {
      Actions?: ImpactAction[];
      "@nextpageuri"?: string;
    };
    for (const a of body.Actions ?? []) {
      if (!a.Id) continue;
      rows.push({
        date: new Date(a.EventDate ?? Date.now()).toISOString(),
        network: "impact",
        program: a.CampaignName ?? a.CampaignId ?? null,
        subId: a.SubId1 || null,
        orderId: a.Id,
        amount: parseMoney(a.Amount),
        commission: parseMoney(a.Payout) ?? 0,
        currency: (a.Currency ?? "USD").toUpperCase(),
        status: normalizeConversionStatus(a.State),
        raw: a as Record<string, unknown>,
      });
    }
    next = body["@nextpageuri"] || null;
  }
  return rows;
}
