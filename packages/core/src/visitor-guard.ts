import { clientIpFrom, hashWithDailySalt } from "@repo/affiliate";

/**
 * Abuse protection for public write endpoints (FR-API-3, NFR-7): Cloudflare Turnstile verification
 * and a fixed-window rate limit. Shared by the web route handlers and the public API.
 */

export interface TurnstileResult {
  ok: boolean;
  /** True when no secret is configured (development): the check is skipped, not failed. */
  skipped: boolean;
  error?: string;
}

/** Verifies a Turnstile token. Without `secret` the check is skipped so local forms keep working. */
export async function verifyTurnstile(
  token: string | null | undefined,
  opts: { secret?: string | null; remoteIp?: string | null; fetch?: typeof fetch } = {},
): Promise<TurnstileResult> {
  if (!opts.secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false, error: "missing-token" };
  const body = new URLSearchParams({ secret: opts.secret, response: token });
  if (opts.remoteIp) body.set("remoteip", opts.remoteIp);
  try {
    const res = await (opts.fetch ?? fetch)("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8_000),
    });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return data.success
      ? { ok: true, skipped: false }
      : { ok: false, skipped: false, error: data["error-codes"]?.join(",") || "rejected" };
  } catch (error) {
    return { ok: false, skipped: false, error: String(error).slice(0, 100) };
  }
}

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** Upstash Redis REST credentials; without them (or on Redis errors) an in-process counter is used. */
  redis?: { url?: string | null; token?: string | null } | null;
  fetch?: typeof fetch;
  now?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, windowMs: number, now: number): number {
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  }
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/** Fixed-window counter: at most `limit` hits per `key` per window (NFR-7). Never throws. */
export async function rateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs);
  const retryAfter = Math.ceil(((windowStart + 1) * windowMs - now) / 1000);
  const windowKey = `rl:${key}:${windowStart}`;
  let count: number | null = null;
  if (opts.redis?.url && opts.redis.token) {
    try {
      const res = await (opts.fetch ?? fetch)(`${opts.redis.url.replace(/\/$/, "")}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.redis.token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["INCR", windowKey],
          ["EXPIRE", windowKey, String(opts.windowSeconds * 2)],
        ]),
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) {
        const data = (await res.json()) as Array<{ result?: unknown }>;
        const n = Number(data[0]?.result);
        if (Number.isFinite(n)) count = n;
      }
    } catch {
      count = null;
    }
  }
  count ??= memoryHit(windowKey, windowMs, now);
  return { allowed: count <= opts.limit, count, retryAfter };
}

/** Upstash credentials from the environment, for `rateLimit`. */
export function redisFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return { url: env.UPSTASH_REDIS_REST_URL ?? null, token: env.UPSTASH_REDIS_REST_TOKEN ?? null };
}

/**
 * Visitor identity for limits and votes: the client IP from proxy headers and its daily-salted hash
 * (NFR-8: never stored raw). The salt secret matches the click logger's.
 */
export async function visitorFromHeaders(
  headers: { get: (name: string) => string | null | undefined },
  secret: string = process.env.REVALIDATE_SECRET ?? "local-dev",
  now = new Date(),
): Promise<{ ip: string | null; ipHash: string }> {
  const ip = clientIpFrom(headers.get("x-forwarded-for") ?? null) ?? headers.get("x-real-ip") ?? null;
  return { ip, ipHash: (await hashWithDailySalt(ip ?? "unknown", secret, now))! };
}

export type GuardResult =
  | { ok: true; ip: string | null; ipHash: string }
  | { ok: false; status: 403 | 429; code: "rate_limited" | "turnstile_failed"; message: string; retryAfter?: number };

/** Rate limit per hashed IP, then Turnstile (FR-API-3, NFR-7). Used by web routes and the API. */
export async function guardVisitorWrite(
  headers: { get: (name: string) => string | null | undefined },
  opts: {
    bucket: string;
    limit: number;
    windowSeconds: number;
    turnstileToken?: string | null;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
  },
): Promise<GuardResult> {
  const env = opts.env ?? process.env;
  const { ip, ipHash } = await visitorFromHeaders(headers, env.REVALIDATE_SECRET ?? "local-dev");
  const limit = await rateLimit(`${opts.bucket}:${ipHash}`, {
    limit: opts.limit,
    windowSeconds: opts.windowSeconds,
    redis: redisFromEnv(env),
    fetch: opts.fetch,
  });
  if (!limit.allowed) {
    return { ok: false, status: 429, code: "rate_limited", message: "Too many requests", retryAfter: limit.retryAfter };
  }
  const turnstile = await verifyTurnstile(opts.turnstileToken, {
    secret: env.TURNSTILE_SECRET_KEY,
    remoteIp: ip,
    fetch: opts.fetch,
  });
  if (!turnstile.ok) return { ok: false, status: 403, code: "turnstile_failed", message: "Verification failed" };
  return { ok: true, ip, ipHash };
}

/** Limits per public write endpoint (per visitor). */
export const VISITOR_LIMITS = {
  vote: { limit: 30, windowSeconds: 600 },
  report: { limit: 5, windowSeconds: 600 },
  newsletter: { limit: 5, windowSeconds: 600 },
} as const;
