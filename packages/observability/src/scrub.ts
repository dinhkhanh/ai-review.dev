/**
 * PII scrubbing for error events (Sentry `beforeSend` / `beforeBreadcrumb`). Pure TypeScript with
 * no SDK imports, so the browser, Node and React Native SDKs can all share it. Events are mutated
 * in place and returned; nothing here throws.
 */

const REDACTED = "[redacted]";

/** Header names never sent. Compared lower-case. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-revalidate-secret",
  "x-forwarded-for",
  "x-real-ip",
  "x-vercel-forwarded-for",
  "x-vercel-proxied-for",
  "cf-connecting-ip",
  "true-client-ip",
  "forwarded",
]);

/** Object keys whose values are dropped wherever they appear (extra, contexts, breadcrumb data). */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|^auth$|cookie|session|credential|vault|otp|email|^ip$|ip_?address|signature|private[-_]?key/i;

/** Query parameters whose values are dropped from URLs and query strings. */
const SENSITIVE_PARAM = /token|secret|key|sig|signature|code|email|unsubscribe|auth|password|otp|state|session/i;

/** Request bodies on these paths carry personal data (newsletter, reports, devices, auth, vault). */
const SENSITIVE_BODY_PATH =
  /\/(api\/(newsletter|report|vote|auth|unsubscribe)|v1\/(newsletter|reports?|votes?|devices|me)|vault|login|two-factor|setup-2fa)(\/|$|\?)/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// Mobile device tokens: `<deviceId uuid>.<secret>`.
const DEVICE_TOKEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{16,}/gi;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// Full and compressed IPv6 (at least three groups, so clock times like 12:30 are left alone).
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}(?::|[0-9a-f]{1,4})(?::[0-9a-f]{1,4})*\b/gi;
// Postgres URLs and similar `scheme://user:password@host`.
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;

const MAX_DEPTH = 6;

/** Removes emails, bearer/basic credentials, device tokens, IPs and URL credentials from text. */
export function scrubString(value: string): string {
  return value
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(DEVICE_TOKEN, "[device-token]")
    .replace(EMAIL, "[email]")
    .replace(IPV4, "[ip]")
    .replace(IPV6, (m) => (m.includes("::") || m.split(":").length >= 4 ? "[ip]" : m));
}

/** Drops the values of sensitive query parameters; keeps the rest of the URL readable. */
export function scrubUrl(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return scrubString(url);
  const hash = url.indexOf("#", q);
  const base = url.slice(0, q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  return `${scrubString(base)}?${scrubQueryString(query)}`;
}

export function scrubQueryString(query: string): string {
  return query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const key = eq < 0 ? pair : pair.slice(0, eq);
      if (eq < 0) return pair;
      let decoded = key;
      try {
        decoded = decodeURIComponent(key);
      } catch {
        // keep the raw key
      }
      return SENSITIVE_PARAM.test(decoded) ? `${key}=${REDACTED}` : `${key}=${scrubString(pair.slice(eq + 1))}`;
    })
    .join("&");
}

/** Deep-scrubs any JSON-ish value: sensitive keys are dropped, strings are cleaned. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrubValue(v, depth + 1);
  }
  return out;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function scrubHeaders(headers: unknown): Obj | undefined {
  if (!isObj(headers)) return undefined;
  const out: Obj = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) continue;
    out[k] = typeof v === "string" ? scrubString(v) : v;
  }
  return out;
}

function scrubRequest(request: Obj): void {
  const url = typeof request.url === "string" ? request.url : "";
  delete request.cookies;
  delete request.env;
  if (request.headers) request.headers = scrubHeaders(request.headers);
  if (typeof request.query_string === "string") request.query_string = scrubQueryString(request.query_string);
  else if (isObj(request.query_string)) request.query_string = scrubValue(request.query_string);
  else if (Array.isArray(request.query_string)) delete request.query_string;
  if ("data" in request) {
    if (SENSITIVE_BODY_PATH.test(url)) request.data = REDACTED;
    else request.data = scrubValue(request.data);
  }
  if (url) request.url = scrubUrl(url);
}

function scrubException(exception: unknown): void {
  if (!isObj(exception) || !Array.isArray(exception.values)) return;
  for (const ex of exception.values) {
    if (!isObj(ex)) continue;
    if (typeof ex.value === "string") ex.value = scrubString(ex.value);
    const frames = isObj(ex.stacktrace) && Array.isArray(ex.stacktrace.frames) ? ex.stacktrace.frames : [];
    for (const frame of frames) if (isObj(frame) && frame.vars) frame.vars = scrubValue(frame.vars);
  }
}

/**
 * `beforeSend` for every SDK. Keeps only the user id (no IP, email or username), strips sensitive
 * headers, cookies, query values and personal request bodies, and cleans free text.
 */
export function scrubEvent<T extends object>(event: T): T {
  try {
    const e = event as Obj;
    if (isObj(e.user)) e.user = typeof e.user.id === "string" || typeof e.user.id === "number" ? { id: e.user.id } : {};
    if (isObj(e.request)) scrubRequest(e.request);
    if (typeof e.message === "string") e.message = scrubString(e.message);
    if (isObj(e.logentry) && typeof e.logentry.message === "string")
      e.logentry.message = scrubString(e.logentry.message);
    if (typeof e.transaction === "string") e.transaction = scrubUrl(e.transaction);
    scrubException(e.exception);
    if (e.extra) e.extra = scrubValue(e.extra);
    if (e.tags) e.tags = scrubValue(e.tags);
    if (isObj(e.contexts)) {
      const contexts = scrubValue(e.contexts) as Obj;
      // The SDK's own runtime/os/device contexts are harmless, but "response" may echo cookies.
      if (isObj(contexts.response) && contexts.response.headers) {
        contexts.response.headers = scrubHeaders(contexts.response.headers);
      }
      e.contexts = contexts;
    }
    if (Array.isArray(e.breadcrumbs)) e.breadcrumbs = e.breadcrumbs.map((b) => (isObj(b) ? scrubBreadcrumb(b) : b));
  } catch {
    // A scrubber bug must never leak data: drop the risky parts instead.
    const e = event as Obj;
    delete e.request;
    delete e.extra;
    delete e.breadcrumbs;
  }
  return event;
}

/** `beforeBreadcrumb`: cleans URLs of fetch/xhr/navigation crumbs and console messages. */
export function scrubBreadcrumb<T extends object>(breadcrumb: T): T {
  const b = breadcrumb as Obj;
  if (typeof b.message === "string") b.message = scrubString(b.message);
  if (isObj(b.data)) {
    const data: Obj = {};
    for (const [k, v] of Object.entries(b.data)) {
      if (SENSITIVE_KEY.test(k)) data[k] = REDACTED;
      else if ((k === "url" || k === "from" || k === "to") && typeof v === "string") data[k] = scrubUrl(v);
      else data[k] = scrubValue(v, 1);
    }
    b.data = data;
  }
  return breadcrumb;
}
