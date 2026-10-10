import type { Effort, Llm } from "@repo/ai";
import {
  HANDS_ON_STOP_REASONS,
  handsOnFindingsSchema,
  type HandsOnAction,
  type HandsOnFindings,
  type HandsOnStopReason,
} from "@repo/core";
import { z } from "zod";
import { renderSnapshot, type BrowserDriver, type PageSnapshot } from "./driver";
import { detectBlocker, refuseClick, refuseNavigate, refuseType, siteOf } from "./guardrails";
import type { Inbox, InboxMessage } from "./inbox";
import { describePlaceholders, redact, resolvePlaceholders, type SessionSecrets } from "./secrets";

/**
 * The hands-on agent loop (FR-RES-7). Each turn the model sees a compact snapshot of the page and
 * answers with one action as structured output; the executor checks it against the guardrails,
 * runs it on the BrowserDriver and reports the result next turn. Caps on steps, spend and time
 * are enforced here, not left to the model. Secrets are typed through {{placeholders}}.
 */

export const HANDS_ON_ACTIONS = [
  "navigate",
  "click",
  "type",
  "select",
  "press",
  "wait",
  "screenshot",
  "check_email",
  "open_link",
  "finish",
  "stop",
] as const;

/** One step. Flat on purpose (structured-output grammar). */
export const agentActionSchema = z.object({
  thought: z.string().describe("One short sentence: what the page shows and why this action"),
  action: z.enum(HANDS_ON_ACTIONS),
  ref: z.string().describe("Element ref such as e12 for click, type and select; empty otherwise"),
  value: z
    .string()
    .describe(
      "navigate: absolute URL; type: the text, using {{placeholders}} for credentials; select: option label; press: key name; wait: milliseconds; screenshot: caption; open_link: link number from the last email; stop: reason code; otherwise empty",
    ),
  observation: z
    .string()
    .describe(
      "Anything new learned about the product on this page (onboarding step, feature, limit, upsell); empty if nothing",
    ),
});
export type AgentAction = z.infer<typeof agentActionSchema>;

const ALLOWED_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "Backspace",
]);
const MAX_MODEL_SCREENSHOTS = 8;

export interface HandsOnAgentInput {
  llm: Llm;
  prompt: { model: string; effort: Effort; system: string };
  driver: BrowserDriver;
  product: { name: string; websiteUrl: string; signupUrl?: string | null };
  secrets: SessionSecrets;
  inbox: Inbox | null;
  policy: { maxSteps: number; maxCostUsd: number; maxMinutes: number };
  /** Stores a screenshot and returns its media asset id (null when storage is unavailable). */
  onScreenshot?: (shot: { bytes: Buffer; caption: string; url: string }) => Promise<string | null>;
  onProgress?: (progress: { actions: HandsOnAction[]; costUsd: number; screenshotAssetIds: string[] }) => Promise<void>;
  log?: (message: string, data?: Record<string, unknown>) => void;
  now?: () => number;
}

export interface HandsOnAgentResult {
  status: "succeeded" | "blocked";
  stopReason: HandsOnStopReason | null;
  detail: string | null;
  actions: HandsOnAction[];
  observations: string[];
  findings: HandsOnFindings | null;
  screenshots: Array<{ assetId: string; caption: string; url: string }>;
  costUsd: number;
  steps: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function describeEmail(email: InboxMessage, secrets: SessionSecrets): string {
  const links = email.links
    .map((l, i) => `[${i + 1}] ${l.label || "(no text)"} — ${new URL(l.url).hostname}`)
    .join("\n");
  return redact(
    [
      `Email from ${email.from}, subject "${email.subject}".`,
      email.codes.length ? `Codes found: ${email.codes.join(", ")}` : "No code found.",
      links ? `Links (use open_link with the number):\n${links}` : "No links.",
      `Body excerpt:\n${clip(email.text, 1500)}`,
    ].join("\n"),
    secrets,
  );
}

export async function runHandsOnAgent(input: HandsOnAgentInput): Promise<HandsOnAgentResult> {
  const { driver, secrets, policy } = input;
  const now = input.now ?? Date.now;
  const log = input.log ?? (() => {});
  const site = siteOf(input.product.websiteUrl);
  const started = now();
  const deadline = started + policy.maxMinutes * 60_000;
  const actions: HandsOnAction[] = [];
  const observations: string[] = [];
  const screenshots: HandsOnAgentResult["screenshots"] = [];
  const seenEmails = new Set<string>();
  let lastEmail: InboxMessage | null = null;
  let lastResult = "Session started.";
  let costUsd = 0;
  let step = 0;
  let outcome: { status: "succeeded" | "blocked"; reason: HandsOnStopReason | null; detail: string | null } | null =
    null;

  const record = (a: Omit<HandsOnAction, "ts" | "step">) => {
    actions.push({ ts: new Date(now()).toISOString(), step, ...a });
  };
  const progress = async () => {
    await input.onProgress?.({ actions, costUsd, screenshotAssetIds: screenshots.map((s) => s.assetId) });
  };
  const capture = async (caption: string) => {
    if (!input.onScreenshot) return null;
    const url = await driver.currentUrl();
    const assetId = await input.onScreenshot({ bytes: await driver.screenshot(), caption, url });
    // Identical images share one content-addressed asset; keep each once.
    if (assetId && !screenshots.some((s) => s.assetId === assetId)) screenshots.push({ assetId, caption, url });
    return assetId;
  };

  const startUrl = input.product.signupUrl || input.product.websiteUrl;
  await driver.navigate(startUrl);
  record({ action: "navigate", url: startUrl, result: "start" });

  while (!outcome) {
    if (step >= policy.maxSteps) {
      outcome = { status: "blocked", reason: "step_limit", detail: `${policy.maxSteps} steps used` };
      break;
    }
    if (now() >= deadline) {
      outcome = { status: "blocked", reason: "time_limit", detail: `${policy.maxMinutes} minutes used` };
      break;
    }
    if (costUsd >= policy.maxCostUsd) {
      outcome = { status: "blocked", reason: "cost_limit", detail: `$${costUsd.toFixed(2)} spent` };
      break;
    }
    step++;

    const snap: PageSnapshot = await driver.observe();
    const blocker = detectBlocker(snap, site);
    if (blocker) {
      await capture(`Where the trial stopped: ${HANDS_ON_STOP_REASONS[blocker.reason]}`).catch(() => null);
      record({ action: "blocked", url: snap.url, result: blocker.detail });
      outcome = { status: "blocked", reason: blocker.reason, detail: blocker.detail };
      break;
    }

    const recent = actions
      .slice(-12)
      .map(
        (a) =>
          `${a.step}. ${a.action}${a.target ? ` ${a.target}` : ""}${a.value ? ` "${a.value}"` : ""}${a.url ? ` ${a.url}` : ""} → ${a.result ?? ""}`,
      )
      .join("\n");
    const minutes = ((now() - started) / 60_000).toFixed(1);
    const turn = await input.llm.generateStructured({
      model: input.prompt.model,
      effort: input.prompt.effort,
      system: input.prompt.system,
      operation: "hands_on_step",
      maxTokens: 16_000,
      schema: agentActionSchema,
      prompt: [
        `Product: ${input.product.name} (${input.product.websiteUrl}). You may act only on ${site}.`,
        `Step ${step} of ${policy.maxSteps}. Time used: ${minutes} of ${policy.maxMinutes} minutes. Spend: $${costUsd.toFixed(2)} of $${policy.maxCostUsd.toFixed(2)}.`,
        "",
        "Credentials (type the placeholders exactly as written):",
        describePlaceholders(secrets),
        secrets.inboxAddress
          ? "Verification emails to {{identity.email}} can be read with check_email."
          : "No inbox is available: if email verification is required, stop with email_not_received.",
        "",
        observations.length ? `Notes so far:\n${observations.map((o) => `- ${o}`).join("\n")}` : "Notes so far: none.",
        "",
        recent ? `Recent actions:\n${recent}` : "",
        `Result of the last action: ${lastResult}`,
        "",
        "<page>",
        redact(renderSnapshot(snap), secrets),
        "</page>",
      ].join("\n"),
    });
    costUsd += turn.cost.costUsd;
    const act = turn.data;
    if (act.observation.trim()) observations.push(redact(act.observation.trim(), secrets).slice(0, 300));
    const el = snap.elements.find((e) => e.ref === act.ref);
    const target = el ? `[${el.ref}] ${el.role} "${clip(el.name, 60)}"` : act.ref || undefined;
    log("hands-on step", { step, action: act.action, target, thought: clip(act.thought, 200) });

    let result: string;
    try {
      switch (act.action) {
        case "navigate": {
          const refusal = refuseNavigate(act.value, site);
          if (refusal) result = refusal;
          else {
            await driver.navigate(act.value);
            result = "ok";
          }
          record({ action: "navigate", url: act.value, result });
          break;
        }
        case "click": {
          const refusal = refuseClick(el, site);
          if (refusal) result = refusal;
          else {
            await driver.click(act.ref);
            result = "ok";
          }
          record({ action: "click", target, result });
          break;
        }
        case "type": {
          const { value, unknown } = resolvePlaceholders(act.value, secrets);
          const refusal = unknown.length
            ? `Unknown placeholder(s): ${unknown.map((u) => `{{${u}}}`).join(", ")}`
            : refuseType(el, value);
          if (refusal) result = refusal;
          else {
            await driver.type(act.ref, value);
            result = "ok";
          }
          // Store the template, never the resolved value.
          record({ action: "type", target, value: redact(act.value, secrets), result });
          break;
        }
        case "select": {
          if (!el || el.role !== "select") result = "That ref is not a select element.";
          else {
            await driver.select(act.ref, act.value);
            result = "ok";
          }
          record({ action: "select", target, value: act.value, result });
          break;
        }
        case "press": {
          if (!ALLOWED_KEYS.has(act.value)) result = `Key not allowed. Use one of: ${[...ALLOWED_KEYS].join(", ")}`;
          else {
            await driver.press(act.value);
            result = "ok";
          }
          record({ action: "press", value: act.value, result });
          break;
        }
        case "wait": {
          const ms = Math.min(Math.max(Number(act.value) || 2000, 250), 10_000);
          await driver.wait(ms);
          result = `waited ${ms} ms`;
          record({ action: "wait", value: String(ms), result });
          break;
        }
        case "screenshot": {
          if (screenshots.length >= MAX_MODEL_SCREENSHOTS) result = "Screenshot limit reached.";
          else {
            const caption = redact(act.value.trim() || "Product screen", secrets).slice(0, 200);
            const id = await capture(caption);
            result = id ? "saved" : "screenshot storage unavailable";
          }
          record({ action: "screenshot", value: act.value.slice(0, 200), result });
          break;
        }
        case "check_email": {
          if (!input.inbox || !secrets.inboxAddress) {
            result = "No inbox is available. If verification is required, stop with email_not_received.";
          } else {
            const remaining = Math.max(0, deadline - now());
            const email = await input.inbox.waitFor({
              to: secrets.inboxAddress,
              since: new Date(started),
              seen: seenEmails,
              timeoutMs: Math.min(120_000, remaining),
            });
            if (!email) result = "No new email arrived within 2 minutes.";
            else {
              seenEmails.add(email.id);
              lastEmail = email;
              result = describeEmail(email, secrets);
            }
          }
          record({ action: "check_email", result: clip(result.split("\n")[0] ?? "", 200) });
          break;
        }
        case "open_link": {
          const link = lastEmail?.links[Number(act.value) - 1];
          if (!link) result = "No such link in the last email.";
          else {
            // Verification links may go through the sender's click tracker; the landing page is
            // checked by the domain guard on the next observe.
            await driver.navigate(link.url);
            result = "ok";
          }
          record({ action: "open_link", url: link ? new URL(link.url).hostname : undefined, result });
          break;
        }
        case "finish": {
          await capture("The product after sign-up").catch(() => null);
          record({ action: "finish", result: "done" });
          outcome = { status: "succeeded", reason: null, detail: null };
          result = "done";
          break;
        }
        case "stop": {
          const reason = (act.value in HANDS_ON_STOP_REASONS ? act.value : "other") as HandsOnStopReason;
          await capture(`Where the trial stopped: ${HANDS_ON_STOP_REASONS[reason]}`).catch(() => null);
          record({ action: "stop", value: reason, result: clip(act.thought, 200) });
          outcome = { status: "blocked", reason, detail: clip(act.thought, 300) };
          result = "stopped";
          break;
        }
      }
    } catch (error) {
      result = `Error: ${clip(String(error instanceof Error ? error.message : error), 300)}`;
      record({ action: act.action, target, result });
    }
    lastResult = redact(result, secrets);
    await progress();
  }

  let findings: HandsOnFindings | null = null;
  if (observations.length > 0 || actions.length > 2) {
    const report = await input.llm.generateStructured({
      model: input.prompt.model,
      effort: input.prompt.effort,
      system: input.prompt.system,
      operation: "hands_on_findings",
      maxTokens: 16_000,
      schema: handsOnFindingsSchema,
      prompt: [
        `The session on ${input.product.name} has ended (${outcome.status}${outcome.reason ? `: ${HANDS_ON_STOP_REASONS[outcome.reason]}` : ""}).`,
        `It took ${((now() - started) / 60_000).toFixed(1)} minutes and ${step} steps.`,
        "Write the final report from these notes and actions only. Record only what was actually seen; never add outside knowledge or guesses. Use empty lists where nothing was observed.",
        "Describe the product, not the testing: never mention the browser, the agent, refused actions or safety checks; if something could not be tried, leave it out.",
        "",
        `Notes:\n${observations.map((o) => `- ${o}`).join("\n") || "(none)"}`,
        "",
        `Actions:\n${actions.map((a) => `${a.step}. ${a.action}${a.target ? ` ${a.target}` : ""}${a.url ? ` ${a.url}` : ""} → ${a.result ?? ""}`).join("\n")}`,
        "",
        `Screenshots: ${screenshots.map((s) => s.caption).join("; ") || "none"}`,
      ].join("\n"),
    });
    costUsd += report.cost.costUsd;
    findings = report.data;
  }

  await progress();
  return {
    status: outcome.status,
    stopReason: outcome.reason,
    detail: outcome.detail,
    actions,
    observations,
    findings,
    screenshots,
    costUsd,
    steps: step,
  };
}
