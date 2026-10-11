/** Minimal, dependency-free HTML helpers. Good enough for server-rendered Next.js output. */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const inner = tag.replace(/^<[a-z0-9-]+/i, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export type Tag = { attrs: Record<string, string>; index: number };

/** Opening tags of one element type, with their position in the document. */
export function findTags(html: string, name: string): Tag[] {
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return [...html.matchAll(re)].map((m) => ({ attrs: parseAttributes(m[0]), index: m.index }));
}

export function metaContent(html: string, key: string): string | undefined {
  const k = key.toLowerCase();
  return findTags(html, "meta").find((t) => (t.attrs.property ?? t.attrs.name ?? "").toLowerCase() === k)?.attrs
    .content;
}

export function titleOf(html: string): string | undefined {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]!.trim()) : undefined;
}

export function canonicalOf(html: string): string | undefined {
  return findTags(html, "link").find((t) => t.attrs.rel?.toLowerCase().split(/\s+/).includes("canonical"))?.attrs.href;
}

export function hreflangAlternates(html: string): { hreflang: string; href: string }[] {
  return findTags(html, "link")
    .filter((t) => t.attrs.rel?.toLowerCase() === "alternate" && t.attrs.hreflang && t.attrs.href)
    .map((t) => ({ hreflang: t.attrs.hreflang!, href: t.attrs.href! }));
}

/** Raw JSON-LD script bodies; `null` entries are scripts that failed to parse. */
export function jsonLdBlocks(html: string): (unknown | null)[] {
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  return [...html.matchAll(re)].map((m) => {
    try {
      return JSON.parse(m[1]!) as unknown;
    } catch {
      return null;
    }
  });
}

/** Path part of an href, resolved against `base` (undefined for non-http links). */
export function pathOf(href: string, base: string): string | undefined {
  try {
    const u = new URL(href, base);
    return u.protocol.startsWith("http") ? u.pathname : undefined;
  } catch {
    return undefined;
  }
}
