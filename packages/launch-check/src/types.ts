export type Status = "pass" | "warn" | "fail" | "skip";

export type CheckResult = {
  /** Stable id, e.g. `review.jsonld`. */
  id: string;
  status: Status;
  message: string;
  /** Requirement the check guards (SRS / plan id). */
  ref?: string;
  /** URL the check looked at. */
  target?: string;
};

export type Mode = "quick" | "full";

export type Options = {
  site: string;
  api?: string;
  cms?: string;
  mode: Mode;
  /** Relaxes HTTPS/HSTS/latency/origin checks for localhost runs. */
  local: boolean;
  maxReviews: number;
  /** IndexNow key, when known, to verify `/<key>.txt`. */
  indexNowKey?: string;
};

export type FetchResult = {
  url: string;
  status: number;
  headers: Headers;
  body: string;
  ms: number;
};

export const result = (
  id: string,
  status: Status,
  message: string,
  extra: { ref?: string; target?: string } = {},
): CheckResult => ({ id, status, message, ...extra });
