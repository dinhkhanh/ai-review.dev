/** Click classification helpers (FR-AFF-7). Cookieless; nothing here identifies a person. */

const BOT_PATTERN =
  /bot|crawl|spider|slurp|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discord|preview|monitor|uptime|headless|lighthouse|python-requests|curl\/|wget|httpclient|go-http-client|axios|node-fetch|okhttp|java\//i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return true;
  return BOT_PATTERN.test(ua);
}

export type DeviceClass = "mobile" | "tablet" | "desktop" | "bot";

export function deviceClass(ua: string | null | undefined): DeviceClass {
  if (isBotUserAgent(ua)) return "bot";
  const s = ua!;
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(s)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(s)) return "mobile";
  return "desktop";
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hashes an IP with a salt that rotates daily (NFR-8): the same visitor hashes identically within
 * a UTC day (enough to spot click bursts) and cannot be linked across days.
 */
export async function hashWithDailySalt(value: string | null | undefined, secret: string, now = new Date()) {
  if (!value) return null;
  const day = now.toISOString().slice(0, 10);
  return (await sha256Hex(`${secret}:${day}:${value}`)).slice(0, 32);
}

/** First address in an X-Forwarded-For style header. */
export function clientIpFrom(forwardedFor: string | null | undefined): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first ? first : null;
}
