import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { GenerateOptions, Llm } from "@repo/ai";
import { buildSessionSecrets, runHandsOnAgent, type Inbox } from "@repo/pipeline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createPlaywrightDriver } from "./playwright-driver";

/**
 * Real-browser check of the hands-on driver and guardrails against a LOCAL fixture site
 * (FR-RES-7): sign-up form with a styled checkbox, email-code verification, an OAuth link on
 * another host and a payment wall. Skips when no Chromium/Chrome can be launched.
 */

async function browserAvailable() {
  try {
    const driver = await createPlaywrightDriver({ wsEndpoint: null });
    await driver.close();
    return true;
  } catch {
    return false;
  }
}
const available = await browserAvailable();

const CODE = "246810";
const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title><style>.vh{position:absolute;opacity:0;width:1px;height:1px}</style></head><body>${body}</body></html>`;

let server: Server;
let base = "";
const posted: Array<Record<string, string>> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (html: string) => res.writeHead(200, { "content-type": "text/html" }).end(html);
    const redirect = (to: string) => res.writeHead(303, { location: to }).end();
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const form = Object.fromEntries(new URLSearchParams(body));
        posted.push({ path: url.pathname, ...form });
        if (url.pathname === "/signup")
          return redirect(form.terms === "on" && form.email && form.password ? "/verify" : "/signup");
        if (url.pathname === "/verify") return redirect(form.code === CODE ? "/app" : "/verify");
        redirect("/");
      });
      return;
    }
    const port = (server.address() as AddressInfo).port;
    switch (url.pathname) {
      case "/":
        return send(
          page("Acme", `<h1>Acme boards</h1><a href="/signup">Start free trial</a> <a href="/pricing">Pricing</a>`),
        );
      case "/signup":
        return send(
          page(
            "Sign up",
            `<form method="post" action="/signup">
              <label>Work email <input name="email" type="email" required></label>
              <label>Password <input name="password" type="password" required></label>
              <input id="terms" name="terms" type="checkbox" class="vh"><label for="terms">I agree to the terms</label>
              <button type="submit">Create account</button>
            </form>
            <a href="http://localhost:${port}/oauth">Sign up with Google</a>`,
          ),
        );
      case "/verify":
        return send(
          page(
            "Verify",
            `<p>We emailed you a code.</p><form method="post" action="/verify"><label>Verification code <input name="code"></label><button>Verify</button></form>`,
          ),
        );
      case "/app":
        return send(
          page("Dashboard", `<h1>Welcome</h1><p>Free plan: 3 boards.</p><a href="/upgrade">Upgrade plan</a>`),
        );
      case "/upgrade":
        return send(
          page("Upgrade", `<h1>Pro</h1><label>Card number <input name="cardnumber" autocomplete="cc-number"></label>`),
        );
      default:
        res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server?.close(r));
});

const identity = { name: "Ada Tester", password: "fixture-password-123" };
const findings = {
  signedUp: true,
  planObserved: "Free",
  onboardingSteps: [],
  timeToValueMinutes: null,
  observedFeatures: [],
  limits: [],
  uiNotes: [],
  summary: "Fixture run.",
};

/** Scripted model: finds refs by element name in the rendered page, like the real one would. */
type Step = { action: string; ref?: string; value?: string; observation?: string };
function scriptedLlm(policy: (url: string, prompt: string, ref: (name: RegExp) => string) => Step): Llm {
  const ref = (prompt: string) => (name: RegExp) => {
    for (const line of prompt.split("\n")) {
      const m = /^\[(e\d+)\] \w+ "([^"]*)"/.exec(line);
      if (m && name.test(m[2]!)) return m[1]!;
    }
    return "";
  };
  return {
    generate: async () => {
      throw new Error("unused");
    },
    generateStructured: async <S extends z.ZodType>(o: GenerateOptions & { schema: S }) => {
      const prompt = o.prompt ?? "";
      const raw =
        o.operation === "hands_on_findings"
          ? findings
          : {
              thought: "",
              ref: "",
              value: "",
              observation: "",
              ...policy(/^URL: (.*)$/m.exec(prompt)?.[1] ?? "", prompt, ref(prompt)),
            };
      return {
        data: o.schema.parse(raw),
        text: "",
        model: o.model,
        stopReason: "end_turn",
        fallbackUsed: false,
        cost: {
          costUsd: 0.001,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          models: [],
          unpricedModels: [],
        },
        raw: {} as never,
      };
    },
  } as unknown as Llm;
}

const inbox: Inbox = {
  waitFor: async () => ({
    id: "m1",
    from: "hi@acme",
    subject: "Code",
    receivedAt: new Date(),
    text: `Code ${CODE}`,
    links: [],
    codes: [CODE],
  }),
};

describe.skipIf(!available)("Playwright driver + hands-on guardrails (local fixture)", () => {
  it("signs up through a real browser: secrets typed, styled checkbox, email code, OAuth refused", async () => {
    const secrets = buildSessionSecrets({ identity, productSlug: "acme", inboxDomain: "trials.test", suffix: "x1" });
    const done = (p: string, s: string) => p.includes(s);
    const llm = scriptedLlm((url, p, ref): Step => {
      const path = new URL(url).pathname;
      if (path === "/") return { action: "click", ref: ref(/free trial/) };
      if (path === "/signup") {
        if (!done(p, 'link "Sign up with Google" →')) return { action: "click", ref: ref(/Google/) };
        if (!done(p, "type [e1]")) return { action: "type", ref: ref(/Work email/), value: "{{identity.email}}" };
        if (!done(p, "type [e2]")) return { action: "type", ref: ref(/Password/), value: "{{identity.password}}" };
        if (!done(p, "click [e3] checkbox")) return { action: "click", ref: ref(/I agree/) };
        return { action: "click", ref: ref(/Create account/) };
      }
      if (path === "/verify") {
        if (!/\d+\. check_email/.test(p)) return { action: "check_email" };
        if (!done(p, 'type [e1] textbox "Verification code"'))
          return { action: "type", ref: ref(/Verification code/), value: CODE };
        return { action: "click", ref: ref(/^Verify$/) };
      }
      if (path === "/app") return { action: "finish", observation: "Free plan: 3 boards" };
      return { action: "stop", value: "other" };
    });
    const driver = await createPlaywrightDriver({ wsEndpoint: null });
    const shots: Buffer[] = [];
    try {
      const result = await runHandsOnAgent({
        llm,
        prompt: { model: "m", effort: "low", system: "s" },
        driver,
        product: { name: "Acme", websiteUrl: `${base}/` },
        secrets,
        inbox,
        policy: { maxSteps: 20, maxCostUsd: 1, maxMinutes: 5 },
        onScreenshot: async ({ bytes }) => (shots.push(bytes), `a${shots.length}`),
      });
      expect(result.status).toBe("succeeded");
      expect(result.actions.find((a) => a.target?.includes("Google"))?.result).toMatch(/Refused: the link leaves/);
      const signup = posted.find((p) => p.path === "/signup");
      expect(signup).toMatchObject({ email: "trial-acme-x1@trials.test", password: identity.password, terms: "on" });
      expect(posted.find((p) => p.path === "/verify")?.code).toBe(CODE);
      expect(shots[0]!.subarray(1, 4).toString()).toBe("PNG");
      expect(JSON.stringify(result.actions)).not.toContain(identity.password);
    } finally {
      await driver.close();
    }
  });

  it("stops as blocked at a payment wall without typing anything", async () => {
    const before = posted.length;
    const llm = scriptedLlm((url): Step =>
      new URL(url).pathname === "/app"
        ? { action: "navigate", value: `${base}/upgrade` }
        : { action: "navigate", value: `${base}/app` },
    );
    const driver = await createPlaywrightDriver({ wsEndpoint: null });
    try {
      const result = await runHandsOnAgent({
        llm,
        prompt: { model: "m", effort: "low", system: "s" },
        driver,
        product: { name: "Acme", websiteUrl: `${base}/` },
        secrets: buildSessionSecrets({ identity, productSlug: "acme" }),
        inbox: null,
        policy: { maxSteps: 6, maxCostUsd: 1, maxMinutes: 5 },
      });
      expect(result).toMatchObject({ status: "blocked", stopReason: "payment_required" });
      expect(posted.length).toBe(before);
    } finally {
      await driver.close();
    }
  });
});
