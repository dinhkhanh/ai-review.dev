import { result, type CheckResult } from "../types.ts";

export type HeaderProfile = "web" | "cms" | "api";

/**
 * Transport and browser-hardening headers (NFR security; plan Phase 4 "Security headers").
 * The public site and CMS need a CSP; the JSON API only needs nosniff, HSTS and frame protection.
 */
export function checkSecurityHeaders(
  profile: HeaderProfile,
  url: string,
  headers: Headers,
  opts: { local: boolean },
): CheckResult[] {
  const id = (s: string) => `headers.${profile}.${s}`;
  const ref = "Phase 4 security headers";
  const out: CheckResult[] = [];
  const target = url;

  if (opts.local) out.push(result(id("hsts"), "skip", "local run", { ref, target }));
  else {
    const hsts = headers.get("strict-transport-security");
    const maxAge = Number(hsts?.match(/max-age=(\d+)/i)?.[1] ?? 0);
    out.push(
      !hsts
        ? result(id("hsts"), "fail", "Strict-Transport-Security missing", { ref, target })
        : maxAge < 15_552_000
          ? result(id("hsts"), "warn", `HSTS max-age ${maxAge}s is under 180 days`, { ref, target })
          : result(id("hsts"), "pass", `max-age=${maxAge}`, { ref, target }),
    );
  }

  const nosniff = headers.get("x-content-type-options")?.toLowerCase() === "nosniff";
  out.push(
    result(id("nosniff"), nosniff ? "pass" : "fail", nosniff ? "nosniff" : "X-Content-Type-Options: nosniff missing", {
      ref,
      target,
    }),
  );

  const referrer = headers.get("referrer-policy");
  out.push(
    referrer
      ? result(id("referrer"), "pass", referrer, { ref, target })
      : result(id("referrer"), profile === "api" ? "warn" : "fail", "Referrer-Policy missing", { ref, target }),
  );

  const csp = headers.get("content-security-policy");
  const frameAncestors = csp?.match(/frame-ancestors\s+([^;]+)/i)?.[1]?.trim();
  const xfo = headers.get("x-frame-options")?.toUpperCase();
  if (profile !== "api") {
    out.push(
      csp
        ? result(id("csp"), "pass", `CSP set (${csp.split(";").length} directives)`, { ref, target })
        : result(id("csp"), "fail", "Content-Security-Policy missing", { ref, target }),
    );
  }
  const framed = Boolean(frameAncestors || xfo === "DENY" || xfo === "SAMEORIGIN");
  out.push(
    framed
      ? result(id("frame"), "pass", frameAncestors ? `frame-ancestors ${frameAncestors}` : `X-Frame-Options ${xfo}`, {
          ref,
          target,
        })
      : result(id("frame"), "fail", "no frame-ancestors in CSP and no X-Frame-Options", { ref, target }),
  );
  if (profile === "cms" && framed && frameAncestors && !/'none'|'self'/.test(frameAncestors) && xfo !== "DENY") {
    out.push(result(id("frame-strict"), "warn", `CMS frame-ancestors allows ${frameAncestors}`, { ref, target }));
  }
  return out;
}
