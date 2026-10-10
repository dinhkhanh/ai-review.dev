import { getDomain, getHostname } from "tldts";
import { DomainError } from "./errors";

/** Accepts "notion.so", "https://www.notion.so/pricing", etc. Returns an https URL origin. */
export function normalizeWebsiteUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new DomainError("invalid", `Not a valid URL: ${input}`);
  }
  if (!getDomain(url.hostname)) throw new DomainError("invalid", `URL has no public domain: ${input}`);
  return `${url.protocol}//${url.hostname.toLowerCase()}`;
}

/** Registrable domain (eTLD+1) used for duplicate detection (FR-INT-4): app.notion.so -> notion.so. */
export function registrableDomain(input: string): string {
  const host = getHostname(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  const domain = host ? getDomain(host) : null;
  if (!domain) throw new DomainError("invalid", `Cannot determine domain for: ${input}`);
  return domain.toLowerCase();
}

/**
 * SSRF guard for admin-submitted URLs (NFR-7): reject IP literals in private/loopback ranges and
 * non-public hostnames. DNS-resolution checks happen in the fetcher at request time.
 */
export function assertPublicHttpUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new DomainError("invalid", "Only http(s) URLs are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const privateV4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  const privateV6 = /^(::1$|fc|fd|fe80:)/i;
  if (host === "localhost" || privateV4.test(host) || privateV6.test(host) || !getDomain(host)) {
    throw new DomainError("forbidden", `Refusing non-public host: ${host}`);
  }
  return url;
}
