import { createSign } from "node:crypto";

/**
 * Google Search Console Search Analytics API (FR-MNT-3). Authenticates as a service account with
 * an RS256-signed JWT (no Google SDK) and pages through `searchAnalytics.query`. The service
 * account must be added as a user on the Search Console property.
 */
export interface SearchConsoleCredentials {
  clientEmail: string;
  privateKey: string;
  /** Property id: `sc-domain:example.com` or a URL-prefix property such as `https://example.com/`. */
  siteUrl: string;
}

export function searchConsoleCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): SearchConsoleCredentials | null {
  const { GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY, GSC_SITE_URL } = env;
  if (!GSC_CLIENT_EMAIL || !GSC_PRIVATE_KEY || !GSC_SITE_URL) return null;
  return { clientEmail: GSC_CLIENT_EMAIL, privateKey: normalizePrivateKey(GSC_PRIVATE_KEY), siteUrl: GSC_SITE_URL };
}

/** Env files and dashboards often store the PEM with literal `\n` and surrounding quotes. */
export function normalizePrivateKey(key: string): string {
  return key
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** API maximum rows per request. */
export const SEARCH_CONSOLE_MAX_ROWS = 25_000;

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** Signed JWT assertion for the OAuth 2.0 JWT-bearer grant (valid for one hour). */
export function serviceAccountAssertion(
  creds: Pick<SearchConsoleCredentials, "clientEmail" | "privateKey">,
  now = new Date(),
  scope = SEARCH_CONSOLE_SCOPE,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.clientEmail, scope, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(creds.privateKey);
  return `${header}.${claims}.${b64url(signature)}`;
}

export type SearchConsoleDimension = "date" | "page" | "query" | "country" | "device";

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsQuery {
  /** YYYY-MM-DD, inclusive (Pacific time, as Search Console reports). */
  startDate: string;
  endDate: string;
  dimensions: SearchConsoleDimension[];
  /** Stop after this many rows in total (default: everything). */
  maxRows?: number;
  /** `final` (default) excludes the last few days that are still being processed. */
  dataState?: "final" | "all";
}

export interface SearchConsoleClient {
  siteUrl: string;
  query(input: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]>;
}

export function createSearchConsoleClient(
  creds: SearchConsoleCredentials | null = searchConsoleCredentialsFromEnv(),
  fetchImpl: typeof fetch = fetch,
): SearchConsoleClient | null {
  if (!creds) return null;
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: serviceAccountAssertion(creds!),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Search Console auth failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Search Console auth returned no access token");
    cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(creds.siteUrl)}/searchAnalytics/query`;

  return {
    siteUrl: creds.siteUrl,
    async query(input) {
      const rows: SearchAnalyticsRow[] = [];
      const max = input.maxRows ?? Number.POSITIVE_INFINITY;
      for (let startRow = 0; rows.length < max;) {
        const rowLimit = Math.min(SEARCH_CONSOLE_MAX_ROWS, max - rows.length);
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: input.dimensions,
            type: "web",
            dataState: input.dataState ?? "final",
            rowLimit,
            startRow,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok)
          throw new Error(`Search Console query failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
        const page = ((await res.json()) as { rows?: SearchAnalyticsRow[] }).rows ?? [];
        rows.push(...page);
        if (page.length < rowLimit) break;
        startRow += page.length;
      }
      return rows;
    },
  };
}
