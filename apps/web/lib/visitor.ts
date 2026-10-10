import { guardVisitorWrite, VISITOR_LIMITS } from "@repo/core";

/** Guards a public form post (FR-API-3, NFR-7): rate limit per hashed IP, then Turnstile. */
export function guardForm(request: Request, form: FormData, bucket: keyof typeof VISITOR_LIMITS) {
  const token = form.get("cf-turnstile-response");
  return guardVisitorWrite(request.headers, {
    bucket,
    ...VISITOR_LIMITS[bucket],
    turnstileToken: typeof token === "string" ? token : null,
  });
}

/** Same-site relative path for post-redirect-get; anything else falls back. */
export function safeReturnPath(value: FormDataEntryValue | null, fallback = "/"): string {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") ? s.slice(0, 300) : fallback;
}

export const wantsJson = (request: Request) => (request.headers.get("accept") ?? "").includes("application/json");
