// Security headers shared by the Next.js apps. Plain JavaScript (with headers.d.mts) because
// next.config.js imports it directly, before any TypeScript tooling runs.

/** Origin of a URL, or null for empty/invalid input. */
export function originOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Sentry ingest origin from a DSN (`https://<key>@o1.ingest.de.sentry.io/2` → `https://o1.ingest.de.sentry.io`). */
export function sentryIngestOrigin(dsn) {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

const uniq = (values) => [...new Set(values.filter(Boolean))];

/**
 * Content-Security-Policy without nonces, so pages stay static/ISR. Next.js streams inline
 * scripts, which is why script-src needs 'unsafe-inline'; the rest of the policy (no plugins, no
 * framing, no foreign forms or base URLs, allow-listed origins) still limits what an injection
 * could do. Development adds 'unsafe-eval' and websockets for React Refresh.
 */
export function buildCsp({
  dev = false,
  script = [],
  connect = [],
  img = [],
  media = [],
  frame = [],
  font = [],
  formAction = [],
  upgradeInsecureRequests = !dev,
} = {}) {
  const directives = [
    ["default-src", ["'self'"]],
    ["script-src", uniq(["'self'", "'unsafe-inline'", dev && "'unsafe-eval'", ...script])],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", uniq(["'self'", "data:", "blob:", ...img])],
    ["font-src", uniq(["'self'", "data:", ...font])],
    ["media-src", uniq(["'self'", "blob:", ...media])],
    ["connect-src", uniq(["'self'", dev && "ws:", dev && "wss:", ...connect])],
    ["frame-src", frame.length ? uniq(frame) : ["'none'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", uniq(["'self'", ...formAction])],
    ["frame-ancestors", ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (upgradeInsecureRequests) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Headers every app sends (HSTS, sniffing, framing, referrer, powerful features). */
export function baseSecurityHeaders({ csp, referrerPolicy = "strict-origin-when-cross-origin" }) {
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: referrerPolicy },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  ];
}
