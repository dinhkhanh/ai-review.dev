import { createHmac } from "node:crypto";

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s), matching better-auth's two-factor plugin, which uses the
 * stored secret's UTF-8 bytes as the HMAC key (the otpauth URI base32-encodes the same bytes).
 */
export function totp(secret: string, now = Date.now(), period = 30, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const mac = createHmac("sha1", Buffer.from(secret, "utf8")).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const code =
    (((mac[offset]! & 127) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!) %
    10 ** digits;
  return code.toString().padStart(digits, "0");
}

/** A code that stays valid for at least `minRemainingMs`, so a slow form submit does not race the step. */
export async function freshTotp(secret: string, minRemainingMs = 5_000): Promise<string> {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < minRemainingMs) await new Promise((r) => setTimeout(r, remaining + 50));
  return totp(secret);
}
