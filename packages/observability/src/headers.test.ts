import { describe, expect, it } from "vitest";
import { baseSecurityHeaders, buildCsp, originOf, sentryIngestOrigin } from "./headers.mjs";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `) || d === name);

describe("buildCsp", () => {
  it("builds a locked-down production policy", () => {
    const csp = buildCsp({
      script: ["https://plausible.io"],
      connect: ["https://plausible.io", null],
      img: ["https://media.ai-review.dev", "https://media.ai-review.dev"],
      frame: ["https://challenges.cloudflare.com"],
    });
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline' https://plausible.io");
    expect(directive(csp, "img-src")).toBe("img-src 'self' data: blob: https://media.ai-review.dev");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://plausible.io");
    expect(directive(csp, "frame-src")).toBe("frame-src https://challenges.cloudflare.com");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "upgrade-insecure-requests")).toBe("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("relaxes only what React dev tooling needs in development", () => {
    const csp = buildCsp({ dev: true });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' ws: wss:");
    expect(directive(csp, "frame-src")).toBe("frame-src 'none'");
    expect(directive(csp, "upgrade-insecure-requests")).toBeUndefined();
  });
});

describe("helpers", () => {
  it("parses origins and Sentry ingest hosts", () => {
    expect(originOf("https://media.ai-review.dev/a/b.png")).toBe("https://media.ai-review.dev");
    expect(originOf("not a url")).toBeNull();
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(sentryIngestOrigin("https://abc@o12.ingest.de.sentry.io/34")).toBe("https://o12.ingest.de.sentry.io");
    expect(sentryIngestOrigin("")).toBeNull();
  });

  it("emits the base headers", () => {
    const keys = baseSecurityHeaders({ csp: "default-src 'self'" }).map((h) => h.key);
    expect(keys).toEqual([
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]);
  });
});
