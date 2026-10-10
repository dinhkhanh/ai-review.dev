import { fetchAwinConversions } from "./awin";
import { fetchImpactConversions } from "./impact";
import { fetchPartnerStackConversions } from "./partnerstack";
import type { ConversionRow, DateRange, FetchLike } from "./types";

export * from "./awin";
export * from "./impact";
export * from "./partnerstack";
export * from "./types";

/** Networks with a reporting connector (FR-AFF-11). */
export const CONVERSION_NETWORKS = ["impact", "partnerstack", "awin"] as const;
export type ConversionNetwork = (typeof CONVERSION_NETWORKS)[number];

/** Which connectors have credentials in this environment (names only, never values). */
export function configuredConversionNetworks(env: NodeJS.ProcessEnv = process.env): ConversionNetwork[] {
  return CONVERSION_NETWORKS.filter((n) =>
    n === "impact"
      ? !!(env.IMPACT_ACCOUNT_SID && env.IMPACT_AUTH_TOKEN)
      : n === "partnerstack"
        ? !!env.PARTNERSTACK_API_KEY
        : !!(env.AWIN_API_TOKEN && env.AWIN_PUBLISHER_ID),
  );
}

/** Fetches one network's conversions with credentials from env. */
export async function fetchNetworkConversions(
  network: ConversionNetwork,
  range: DateRange,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<ConversionRow[]> {
  if (network === "impact") {
    return fetchImpactConversions(
      range,
      { accountSid: env.IMPACT_ACCOUNT_SID!, authToken: env.IMPACT_AUTH_TOKEN! },
      fetchImpl,
    );
  }
  if (network === "partnerstack") {
    return fetchPartnerStackConversions(range, { apiKey: env.PARTNERSTACK_API_KEY! }, fetchImpl);
  }
  return fetchAwinConversions(range, { apiToken: env.AWIN_API_TOKEN!, publisherId: env.AWIN_PUBLISHER_ID! }, fetchImpl);
}
