import { ctaTarget, type GoLinkTable } from "@repo/affiliate";
import { loadGoLinkTable } from "@repo/core";
import { getDb } from "@repo/db";
import { Redis } from "@upstash/redis";

/**
 * Go-link table cache (NFR-2): per-instance memory (30 s) in front of Upstash Redis (60 s), DB on
 * miss. The CMS deletes the Redis key on link/program changes, so new links apply within a minute
 * everywhere (FR-AFF-8). Dates are revived after JSON round-trips.
 */
const MEMORY_TTL_MS = 30_000;
const REDIS_TTL_S = 60;
const memory = new Map<string, { at: number; table: GoLinkTable | null }>();

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;
  }
  return redis;
}

export const goLinkCacheKey = (slug: string) => `golink:v1:${slug}`;

function revive(raw: string): GoLinkTable | null {
  const parsed = JSON.parse(raw) as GoLinkTable | null;
  if (!parsed) return null;
  return {
    ...parsed,
    links: parsed.links.map((l) => ({
      ...l,
      startsAt: l.startsAt ? new Date(l.startsAt) : null,
      endsAt: l.endsAt ? new Date(l.endsAt) : null,
    })),
  };
}

export async function getGoLinkTable(slug: string): Promise<GoLinkTable | null> {
  const hit = memory.get(slug);
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return hit.table;
  const r = getRedis();
  try {
    if (r) {
      const cached = await r.get<string>(goLinkCacheKey(slug));
      if (cached !== null && cached !== undefined) {
        const table = revive(typeof cached === "string" ? cached : JSON.stringify(cached));
        memory.set(slug, { at: Date.now(), table });
        return table;
      }
    }
  } catch (error) {
    console.warn("go-link cache read failed", error);
  }
  try {
    const table = await loadGoLinkTable(getDb(), slug);
    memory.set(slug, { at: Date.now(), table });
    if (r) await r.set(goLinkCacheKey(slug), JSON.stringify(table), { ex: REDIS_TTL_S }).catch(() => {});
    return table;
  } catch (error) {
    // Database trouble: serve a stale entry rather than fail the visitor.
    if (hit) return hit.table;
    throw error;
  }
}

/** CTA targets that must bypass /go because the program forbids redirects (C-2). */
export async function directLinksFor(slug: string | null, articleSlug: string): Promise<Record<string, string>> {
  if (!slug) return {};
  const table = await loadGoLinkTable(getDb(), slug).catch(() => null);
  if (!table) return {};
  const target = ctaTarget(table, { articleSlug, placement: "direct" });
  return target.kind === "direct" ? { [slug]: target.url } : {};
}

/** Simple per-minute counter for click-burst detection (NFR-7); bursts are logged as bots. */
export async function isClickBurst(ipHash: string | null): Promise<boolean> {
  const r = getRedis();
  if (!r || !ipHash) return false;
  try {
    const key = `rl:go:${ipHash}:${Math.floor(Date.now() / 60_000)}`;
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, 120);
    return n > 30;
  } catch {
    return false;
  }
}
