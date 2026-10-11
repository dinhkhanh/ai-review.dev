import { describe, expect, it } from "vitest";
import { sentryOptions, serverSentryOptions } from "./options";
import { scrubBreadcrumb, scrubEvent, scrubQueryString, scrubString, scrubUrl } from "./scrub";

describe("scrubString", () => {
  it("removes emails, credentials, device tokens and IPs", () => {
    const text =
      "user jane.doe@example.com from 203.0.113.9 and 2001:db8::1 sent Bearer abc.def-123 with " +
      "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e.s3cr3tS3cr3tS3cr3tS3 via postgres://app:hunter2@db.local:5432/x";
    const out = scrubString(text);
    expect(out).not.toContain("jane.doe");
    expect(out).not.toContain("203.0.113.9");
    expect(out).not.toContain("2001:db8::1");
    expect(out).not.toContain("abc.def-123");
    expect(out).not.toContain("s3cr3t");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[email]");
    expect(out).toContain("[device-token]");
    expect(out).toContain("postgres://[redacted]@db.local");
  });

  it("leaves ordinary text and clock times alone", () => {
    expect(scrubString("Plan costs $12 at 12:30:45 on v1.4.0")).toBe("Plan costs $12 at 12:30:45 on v1.4.0");
  });
});

describe("scrubUrl / scrubQueryString", () => {
  it("drops sensitive parameter values only", () => {
    expect(scrubUrl("https://ai-review.dev/api/newsletter/unsubscribe?token=abc&email=a%40b.de&p=hero#x")).toBe(
      "https://ai-review.dev/api/newsletter/unsubscribe?token=[redacted]&email=[redacted]&p=hero",
    );
    expect(scrubQueryString("q=notion&page=2")).toBe("q=notion&page=2");
    expect(scrubUrl("/reviews/notion-review")).toBe("/reviews/notion-review");
  });
});

describe("scrubEvent", () => {
  it("strips user PII, headers, cookies and personal request bodies", () => {
    const event = scrubEvent({
      user: { id: "u1", email: "a@b.de", ip_address: "1.2.3.4", username: "jane" },
      request: {
        url: "https://ai-review.dev/api/newsletter?ref=footer",
        method: "POST",
        cookies: { session: "x" },
        headers: { Cookie: "a=b", Authorization: "Bearer t", "x-forwarded-for": "1.2.3.4", "user-agent": "UA" },
        query_string: "ref=footer&token=t",
        data: { email: "a@b.de" },
      },
      message: "Failed for a@b.de",
      extra: { vaultValue: "pw", nested: { password: "x", note: "ip 10.0.0.1" } },
      exception: { values: [{ value: "boom for a@b.de", stacktrace: { frames: [{ vars: { token: "t", n: 1 } }] } }] },
      breadcrumbs: [{ category: "fetch", data: { url: "/v1/me/saved?token=t", method: "GET" } }],
    });
    expect(event.user).toEqual({ id: "u1" });
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.headers).toEqual({ "user-agent": "UA" });
    expect(event.request.query_string).toBe("ref=footer&token=[redacted]");
    expect(event.request.data).toBe("[redacted]");
    expect(event.message).toBe("Failed for [email]");
    expect(event.extra).toEqual({ vaultValue: "[redacted]", nested: { password: "[redacted]", note: "ip [ip]" } });
    expect(event.exception.values[0]?.value).toBe("boom for [email]");
    expect(event.exception.values[0]?.stacktrace.frames[0]?.vars).toEqual({ token: "[redacted]", n: 1 });
    expect(event.breadcrumbs[0]?.data.url).toBe("/v1/me/saved?token=[redacted]");
  });

  it("keeps non-personal request bodies but cleans them", () => {
    const event = scrubEvent({ request: { url: "https://api.ai-review.dev/v1/search", data: { q: "mail me@x.io" } } });
    expect(event.request.data).toEqual({ q: "mail [email]" });
  });

  it("drops risky parts if scrubbing throws", () => {
    const evil = { request: { url: "x" }, extra: { a: 1 } } as Record<string, unknown>;
    Object.defineProperty(evil, "message", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
    });
    const out = scrubEvent(evil);
    expect(out.request).toBeUndefined();
    expect(out.extra).toBeUndefined();
  });
});

describe("scrubBreadcrumb", () => {
  it("cleans navigation URLs and console text", () => {
    expect(scrubBreadcrumb({ message: "hi a@b.de", data: { from: "/x?code=1", to: "/y", password: "p" } })).toEqual({
      message: "hi [email]",
      data: { from: "/x?code=[redacted]", to: "/y", password: "[redacted]" },
    });
  });
});

describe("sentryOptions", () => {
  it("is disabled without a DSN and clamps the sample rate", () => {
    expect(sentryOptions({ dsn: "" }).enabled).toBe(false);
    const o = sentryOptions({
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "production",
      tracesSampleRate: "5",
    });
    expect(o).toMatchObject({ enabled: true, environment: "production", sendDefaultPii: false, tracesSampleRate: 1 });
    expect(sentryOptions({ dsn: "x", tracesSampleRate: "nope" }).tracesSampleRate).toBe(0);
  });

  it("reads server env with Vercel fallbacks", () => {
    expect(serverSentryOptions({ SENTRY_DSN: "d", VERCEL_ENV: "preview" })).toMatchObject({
      dsn: "d",
      environment: "preview",
    });
  });
});
