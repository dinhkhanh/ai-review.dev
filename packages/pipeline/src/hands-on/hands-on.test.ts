import { describe, expect, it } from "vitest";
import { runHandsOnAgent, type AgentAction } from "./agent";
import type { PageSnapshot } from "./driver";
import { detectBlocker, looksLikeCardNumber, refuseClick, refuseNavigate, refuseType, siteOf } from "./guardrails";
import { createResendInbox, parseVerificationEmail, type Inbox } from "./inbox";
import { buildSessionSecrets, redact, resolvePlaceholders } from "./secrets";
import { currentUrl, fakeAgentLlm, fakeSite, refFor, type FakePage } from "./testing";

const identity = { name: "Ada Tester", password: "correct horse battery staple", company: "AI Review" };
const secrets = () =>
  buildSessionSecrets({ identity, productSlug: "acme-app", inboxDomain: "trials.example.com", suffix: "abc123" });

const snap = (over: Partial<PageSnapshot>): PageSnapshot => ({
  url: "https://app.acme.io/signup",
  title: "Sign up",
  text: "Create your account",
  elements: [],
  frames: [],
  ...over,
});

describe("hands-on guardrails (FR-RES-7)", () => {
  it("keeps the agent on the product's registrable domain", () => {
    expect(siteOf("https://app.acme.io/x")).toBe("acme.io");
    expect(siteOf("http://127.0.0.1:4000/")).toBe("127.0.0.1");
    expect(detectBlocker(snap({}), "acme.io")).toBeNull();
    expect(detectBlocker(snap({ url: "https://evil.com/" }), "acme.io")?.reason).toBe("off_domain");
    expect(detectBlocker(snap({ url: "https://accounts.google.com/o/oauth2" }), "acme.io")?.reason).toBe("oauth_only");
    expect(refuseNavigate("https://docs.acme.io/start", "acme.io")).toBeNull();
    expect(refuseNavigate("https://other.io/", "acme.io")).toMatch(/not on acme.io/);
    expect(refuseNavigate("https://acme.io/checkout", "acme.io")).toMatch(/checkout/);
    expect(refuseNavigate("javascript:alert(1)", "acme.io")).toMatch(/http/);
  });

  it("stops on payment fields, payment widgets, checkout pages, CAPTCHAs and phone checks", () => {
    const card = { ref: "e1", role: "textbox" as const, name: "Card number", tag: "input" };
    expect(detectBlocker(snap({ elements: [card] }), "acme.io")?.reason).toBe("payment_required");
    expect(detectBlocker(snap({ elements: [{ ...card, name: "", autocomplete: "cc-exp" }] }), "acme.io")?.reason).toBe(
      "payment_required",
    );
    expect(
      detectBlocker(
        snap({ frames: [{ src: "https://js.stripe.com/v3/elements-inner-card.html", visible: true }] }),
        "acme.io",
      )?.reason,
    ).toBe("payment_required");
    expect(detectBlocker(snap({ url: "https://acme.io/billing/checkout" }), "acme.io")?.reason).toBe(
      "payment_required",
    );
    expect(detectBlocker(snap({ url: "https://checkout.stripe.com/c/pay/x" }), "acme.io")?.reason).toBe(
      "payment_required",
    );
    // Invisible reCAPTCHA v3 badges do not count; visible challenges do.
    expect(
      detectBlocker(
        snap({ frames: [{ src: "https://www.google.com/recaptcha/api2/anchor?size=invisible", visible: true }] }),
        "acme.io",
      ),
    ).toBeNull();
    expect(
      detectBlocker(
        snap({ frames: [{ src: "https://newassets.hcaptcha.com/captcha/v1/x#frame=checkbox", visible: true }] }),
        "acme.io",
      )?.reason,
    ).toBe("captcha");
    expect(detectBlocker(snap({ frames: [{ src: "https://hcaptcha.com/x", visible: false }] }), "acme.io")).toBeNull();
    expect(
      detectBlocker(snap({ text: "We sent a code to your phone. Verify your phone number." }), "acme.io")?.reason,
    ).toBe("phone_verification");
  });

  it("refuses paid-plan clicks, off-site links, payment/phone fields and card numbers", () => {
    const btn = (name: string, extra = {}) => ({ ref: "e1", role: "button" as const, name, tag: "button", ...extra });
    expect(refuseClick(btn("Start free trial"), "acme.io")).toBeNull();
    expect(refuseClick(btn("Upgrade to Pro"), "acme.io")).toMatch(/paid plan/);
    expect(refuseClick(btn("Buy now"), "acme.io")).toMatch(/paid plan/);
    expect(refuseClick(btn("Upgrade to Pro trial"), "acme.io")).toBeNull();
    expect(refuseClick(btn("Add card"), "acme.io")).toBeNull();
    expect(refuseClick(btn("Add payment method"), "acme.io")).toMatch(/paid plan/);
    expect(
      refuseClick({ ...btn("Continue with Google"), role: "link", href: "https://accounts.google.com/x" }, "acme.io"),
    ).toMatch(/third-party/);
    expect(refuseClick(undefined, "acme.io")).toMatch(/Unknown element/);
    const field = (name: string, extra = {}) => ({ ref: "e2", role: "textbox" as const, name, tag: "input", ...extra });
    expect(refuseType(field("Work email"), "a@b.co")).toBeNull();
    expect(refuseType(field("Phone", { type: "tel" }), "123")).toMatch(/phone/);
    expect(refuseType(field("CVC"), "123")).toMatch(/payment/);
    expect(refuseType(field("Notes"), "4242 4242 4242 4242")).toMatch(/card number/);
    expect(looksLikeCardNumber("4242424242424241")).toBe(false);
  });
});

describe("hands-on secrets", () => {
  it("gives each session its own inbox address and keeps passwords out of text", () => {
    const s = secrets();
    expect(s.inboxAddress).toBe("trial-acmeapp-abc123@trials.example.com");
    expect(resolvePlaceholders("{{identity.email}}", s)).toEqual({ value: s.inboxAddress, unknown: [], secret: false });
    const pw = resolvePlaceholders("{{ identity.password }}", s);
    expect(pw.value).toBe(identity.password);
    expect(pw.secret).toBe(true);
    expect(resolvePlaceholders("{{card.number}}", s).unknown).toEqual(["card.number"]);
    expect(redact(`password is ${identity.password}`, s)).toBe("password is {{identity.password}}");
    const noInbox = buildSessionSecrets({ identity: { ...identity, email: "ada@example.org" }, productSlug: "x" });
    expect(noInbox.inboxAddress).toBeNull();
    expect(noInbox.values.get("identity.email")).toBe("ada@example.org");
  });
});

describe("verification inbox (Resend receiving API)", () => {
  it("extracts codes and verification links, skipping unsubscribe links", () => {
    const parsed = parseVerificationEmail({
      html: `<p>Your verification code is <b>482913</b></p><a href="https://click.mail.acme.io/v?u=1&amp;t=2">Verify email</a><a href="https://acme.io/unsubscribe">Unsubscribe</a>`,
    });
    expect(parsed.codes).toEqual(["482913"]);
    expect(parsed.links).toEqual([{ url: "https://click.mail.acme.io/v?u=1&t=2", label: "Verify email" }]);
  });

  it("polls the receiving list for the session address and fetches the body", async () => {
    const requests: string[] = [];
    let polls = 0;
    let clock = 0;
    const fetchImpl = (async (url: string) => {
      requests.push(url);
      if (url.endsWith("/emails/receiving?limit=50")) {
        polls++;
        const data =
          polls < 2
            ? []
            : [
                { id: "old", to: ["other@trials.example.com"], created_at: "2026-10-11T10:00:00Z" },
                { id: "m1", to: ["Trial-AcmeApp-abc123@trials.example.com"], created_at: "2026-10-11T10:00:05Z" },
              ];
        return new Response(JSON.stringify({ object: "list", data }));
      }
      return new Response(JSON.stringify({ from: "Acme <hi@acme.io>", subject: "Confirm", text: "Code: 123456" }));
    }) as typeof fetch;
    const inbox = createResendInbox({ apiKey: "re_test", fetch: fetchImpl, now: () => (clock += 1) });
    const msg = await inbox.waitFor({
      to: "trial-acmeapp-abc123@trials.example.com",
      since: new Date("2026-10-11T10:00:00Z"),
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(msg?.id).toBe("m1");
    expect(msg?.codes).toEqual(["123456"]);
    expect(requests.at(-1)).toBe("https://api.resend.com/emails/receiving/m1");
  });
});

const SITE: Record<string, FakePage> = {
  "https://acme.io/": {
    title: "Acme",
    text: "Acme boards for teams. Free plan available.",
    elements: [
      { id: "signup", role: "link", name: "Start free trial", tag: "a", href: "https://acme.io/signup", to: "/signup" },
      { id: "google", role: "link", name: "Continue with Google", tag: "a", href: "https://accounts.google.com/o" },
    ],
  },
  "https://acme.io/signup": {
    title: "Sign up",
    text: "Create your Acme account",
    elements: [
      { id: "email", role: "textbox", name: "Work email", tag: "input", type: "email", required: true },
      { id: "password", role: "password", name: "Password", tag: "input", type: "password", required: true },
      { id: "phone", role: "textbox", name: "Phone (optional)", tag: "input", type: "tel" },
      { id: "create", role: "button", name: "Create account", tag: "button" },
    ],
  },
  "https://acme.io/verify": {
    title: "Verify",
    text: "We emailed you a code",
    elements: [
      { id: "code", role: "textbox", name: "Verification code", tag: "input" },
      { id: "verify", role: "button", name: "Verify", tag: "button" },
    ],
  },
  "https://acme.io/app": {
    title: "Dashboard",
    text: "Welcome Ada. Your 14-day Pro trial has started.",
    elements: [
      { id: "new", role: "button", name: "New board", tag: "button", to: "/app/board" },
      { id: "upgrade", role: "button", name: "Upgrade now", tag: "button", to: "/checkout" },
    ],
  },
  "https://acme.io/app/board": { title: "Board", text: "Untitled board. Add a card.", elements: [] },
  "https://acme.io/checkout": {
    title: "Checkout",
    text: "Pay",
    elements: [{ id: "cc", role: "textbox", name: "Card number", tag: "input", autocomplete: "cc-number" }],
  },
};

function siteFor(s: ReturnType<typeof secrets>) {
  return fakeSite(SITE, {
    onClick: (url, id, typed) => {
      if (id === "create")
        return typed.get("email") === s.inboxAddress && typed.get("password") === identity.password ? "/verify" : null;
      if (id === "verify") return typed.get("code") === "123456" ? "/app" : null;
      return null;
    },
  });
}

const fakeInbox = (): Inbox => ({
  waitFor: async () => ({
    id: "m1",
    from: "hi@acme.io",
    subject: "Your code",
    receivedAt: new Date(),
    text: "Code 123456",
    links: [],
    codes: ["123456"],
  }),
});

const findings = {
  signedUp: true,
  planObserved: "14-day Pro trial",
  onboardingSteps: ["Email and password", "Email code"],
  timeToValueMinutes: 2,
  observedFeatures: ["Boards"],
  limits: [],
  uiNotes: [],
  summary: "Sign-up worked.",
};

const act = (action: AgentAction["action"], ref = "", value = "", observation = ""): AgentAction => ({
  thought: action,
  action,
  ref,
  value,
  observation,
});

/** A model that walks the happy path, trying a few forbidden things on the way. */
function happyPolicy(op: string, prompt: string) {
  if (op === "hands_on_findings") return findings;
  const url = currentUrl(prompt);
  const done = (line: string) => prompt.includes(line);
  if (url === "https://acme.io/") {
    if (!done('click [e2] link "Continue with Google"')) return act("click", refFor(prompt, /Google/));
    return act("click", refFor(prompt, /free trial/));
  }
  if (url === "https://acme.io/signup") {
    if (!done('type [e1] textbox "Work email"')) return act("type", refFor(prompt, /email/i), "{{identity.email}}");
    if (!done('type [e2] password "Password"')) return act("type", refFor(prompt, /Password/), "{{identity.password}}");
    if (!done('type [e3] textbox "Phone (optional)"')) return act("type", refFor(prompt, /Phone/), "+1 555 0100");
    return act("click", refFor(prompt, /Create account/));
  }
  if (url === "https://acme.io/verify") {
    if (!/\d+\. check_email/.test(prompt)) return act("check_email");
    if (!done('type [e1] textbox "Verification code"')) return act("type", refFor(prompt, /code/i), "123456");
    return act("click", refFor(prompt, /^Verify$/));
  }
  if (url === "https://acme.io/app") {
    if (!done('click [e2] button "Upgrade now"')) return act("click", refFor(prompt, /Upgrade/));
    return act("click", refFor(prompt, /New board/), "", "Dashboard shows a 14-day Pro trial");
  }
  if (url === "https://acme.io/app/board") {
    if (!/\d+\. screenshot/.test(prompt))
      return act("screenshot", "", "Empty board after sign-up", "Boards start empty");
    return act("finish");
  }
  return act("stop", "", "other");
}

describe("hands-on agent loop", () => {
  it("signs up with substituted secrets, verifies by email, refuses forbidden actions and reports findings", async () => {
    const s = secrets();
    const site = siteFor(s);
    const { llm, calls } = fakeAgentLlm(happyPolicy);
    const shots: string[] = [];
    let progressCalls = 0;
    const result = await runHandsOnAgent({
      llm,
      prompt: { model: "m", effort: "low", system: "sys" },
      driver: site,
      product: { name: "Acme", websiteUrl: "https://acme.io/" },
      secrets: s,
      inbox: fakeInbox(),
      policy: { maxSteps: 30, maxCostUsd: 2, maxMinutes: 15 },
      onScreenshot: async ({ caption }) => {
        shots.push(caption);
        return `asset-${shots.length}`;
      },
      onProgress: async () => {
        progressCalls++;
      },
    });
    expect(result.status).toBe("succeeded");
    expect(result.findings?.planObserved).toBe("14-day Pro trial");
    expect(site.typed.get("password")).toBe(identity.password);
    expect(site.typed.has("phone")).toBe(false);
    expect(site.visited).not.toContain("https://acme.io/checkout");
    expect(site.visited.some((u) => u.includes("google"))).toBe(false);
    expect(shots).toEqual(["Empty board after sign-up", "The product after sign-up"]);
    expect(result.observations).toContain("Dashboard shows a 14-day Pro trial");
    const refused = result.actions.filter((a) => a.result?.startsWith("Refused"));
    expect(refused.map((a) => a.action)).toEqual(["click", "type", "click"]);
    // Neither stored actions nor any prompt contains the password.
    expect(JSON.stringify(result.actions)).not.toContain(identity.password);
    expect(calls.some((c) => c.prompt.includes(identity.password))).toBe(false);
    expect(result.actions.find((a) => a.action === "type" && a.target?.includes("Password"))?.value).toBe(
      "{{identity.password}}",
    );
    expect(result.costUsd).toBeCloseTo(calls.length * 0.01);
    expect(progressCalls).toBeGreaterThan(5);
  });

  it("ends as blocked when a payment wall appears, with evidence", async () => {
    const site = fakeSite(SITE, { start: "https://acme.io/app" });
    const { llm } = fakeAgentLlm((op, prompt) =>
      op === "hands_on_findings"
        ? { ...findings, signedUp: false }
        : currentUrl(prompt).endsWith("/app")
          ? act("navigate", "", "https://acme.io/pricing")
          : act("wait"),
    );
    // Simulate an in-app redirect to checkout.
    const driver = { ...site, navigate: async () => site.navigate("https://acme.io/checkout") };
    const shots: string[] = [];
    const result = await runHandsOnAgent({
      llm,
      prompt: { model: "m", effort: "low", system: "sys" },
      driver,
      product: { name: "Acme", websiteUrl: "https://acme.io/" },
      secrets: secrets(),
      inbox: null,
      policy: { maxSteps: 10, maxCostUsd: 2, maxMinutes: 15 },
      onScreenshot: async ({ caption }) => (shots.push(caption), "a1"),
    });
    expect(result.status).toBe("blocked");
    expect(result.stopReason).toBe("payment_required");
    expect(shots[0]).toMatch(/payment form/);
    expect(site.typed.size).toBe(0);
  });

  it("enforces step and cost caps in code", async () => {
    const loop = () => fakeAgentLlm((op) => (op === "hands_on_findings" ? findings : act("wait")), 0.3);
    const base = {
      prompt: { model: "m", effort: "low" as const, system: "sys" },
      product: { name: "Acme", websiteUrl: "https://acme.io/" },
      secrets: secrets(),
      inbox: null,
    };
    const bySteps = await runHandsOnAgent({
      ...base,
      llm: loop().llm,
      driver: fakeSite(SITE),
      policy: { maxSteps: 3, maxCostUsd: 100, maxMinutes: 15 },
    });
    expect(bySteps).toMatchObject({ status: "blocked", stopReason: "step_limit", steps: 3 });
    const byCost = await runHandsOnAgent({
      ...base,
      llm: loop().llm,
      driver: fakeSite(SITE),
      policy: { maxSteps: 50, maxCostUsd: 1, maxMinutes: 15 },
    });
    expect(byCost).toMatchObject({ status: "blocked", stopReason: "cost_limit", steps: 4 });
  });

  it("maps model stop codes and treats unknown ones as other", async () => {
    const { llm } = fakeAgentLlm((op) => (op === "hands_on_findings" ? findings : act("stop", "", "oauth_only")));
    const r = await runHandsOnAgent({
      llm,
      prompt: { model: "m", effort: "low", system: "sys" },
      driver: fakeSite(SITE),
      product: { name: "Acme", websiteUrl: "https://acme.io/" },
      secrets: secrets(),
      inbox: null,
      policy: { maxSteps: 5, maxCostUsd: 2, maxMinutes: 15 },
    });
    expect(r).toMatchObject({ status: "blocked", stopReason: "oauth_only" });
    const { llm: llm2 } = fakeAgentLlm((op) => (op === "hands_on_findings" ? findings : act("stop", "", "bored")));
    const r2 = await runHandsOnAgent({
      llm: llm2,
      prompt: { model: "m", effort: "low", system: "sys" },
      driver: fakeSite(SITE),
      product: { name: "Acme", websiteUrl: "https://acme.io/" },
      secrets: secrets(),
      inbox: null,
      policy: { maxSteps: 5, maxCostUsd: 2, maxMinutes: 15 },
    });
    expect(r2.stopReason).toBe("other");
  });
});
