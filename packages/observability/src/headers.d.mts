export interface CspSources {
  dev?: boolean;
  script?: Array<string | null | undefined>;
  connect?: Array<string | null | undefined>;
  img?: Array<string | null | undefined>;
  media?: Array<string | null | undefined>;
  frame?: Array<string | null | undefined>;
  font?: Array<string | null | undefined>;
  formAction?: Array<string | null | undefined>;
  upgradeInsecureRequests?: boolean;
}
export interface Header {
  key: string;
  value: string;
}
export function originOf(url: string | null | undefined): string | null;
export function sentryIngestOrigin(dsn: string | null | undefined): string | null;
export function buildCsp(sources?: CspSources): string;
export function baseSecurityHeaders(opts: { csp: string; referrerPolicy?: string }): Header[];
