import { randomBytes } from "node:crypto";
import type { ProductCredential, TestIdentity } from "@repo/core";

/**
 * Credentials for one session, referenced by the model as {{identity.email}}, {{identity.password}}
 * and so on. The model never sees passwords; the executor substitutes them when typing and
 * `redact()` replaces any resolved value with its placeholder before text is stored or sent back.
 */
export interface SessionSecrets {
  /** placeholder (without braces) -> value */
  values: Map<string, string>;
  /** Placeholders whose values the model may see (e.g. the inbox address, the name). */
  visible: Set<string>;
  /** Address verification emails go to; null when no inbox is configured. */
  inboxAddress: string | null;
}

/**
 * Builds the session's placeholders. With an inbox domain each session signs up with a fresh
 * address on it (so the inbox can be filtered per session); otherwise the identity's own email.
 */
export function buildSessionSecrets(input: {
  identity: TestIdentity;
  productSlug: string;
  inboxDomain?: string | null;
  login?: ProductCredential | null;
  /** Injected for tests. */
  suffix?: string;
}): SessionSecrets {
  const values = new Map<string, string>();
  const visible = new Set<string>();
  const [first, ...rest] = input.identity.name.trim().split(/\s+/);
  const domain = input.inboxDomain?.trim().toLowerCase() || null;
  const suffix = input.suffix ?? randomBytes(3).toString("hex");
  const local = `trial-${input.productSlug
    .replace(/[^a-z0-9]+/gi, "")
    .slice(0, 20)
    .toLowerCase()}-${suffix}`;
  const email = domain ? `${local}@${domain}` : (input.identity.email ?? null);
  if (email) {
    values.set("identity.email", email);
    visible.add("identity.email");
  }
  values.set("identity.password", input.identity.password);
  values.set("identity.name", input.identity.name.trim());
  values.set("identity.firstName", first ?? input.identity.name.trim());
  values.set("identity.lastName", rest.join(" ") || "Tester");
  for (const key of ["identity.name", "identity.firstName", "identity.lastName"]) visible.add(key);
  if (input.identity.company) {
    values.set("identity.company", input.identity.company);
    visible.add("identity.company");
  }
  if (input.login) {
    values.set("login.username", input.login.username);
    values.set("login.password", input.login.password);
  }
  return { values, visible, inboxAddress: domain ? email : null };
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+\.[a-zA-Z]+)\s*\}\}/g;

/** Replaces placeholders; unknown ones are an error the model sees. */
export function resolvePlaceholders(
  text: string,
  secrets: SessionSecrets,
): { value: string; unknown: string[]; secret: boolean } {
  const unknown: string[] = [];
  let secret = false;
  const value = text.replace(PLACEHOLDER, (match, key: string) => {
    const v = secrets.values.get(key);
    if (v === undefined) {
      unknown.push(key);
      return match;
    }
    if (!secrets.visible.has(key)) secret = true;
    return v;
  });
  return { value, unknown, secret };
}

/** Replaces every non-visible secret value (and the password in any case) with its placeholder. */
export function redact(text: string, secrets: SessionSecrets): string {
  let out = text;
  for (const [key, value] of secrets.values) {
    if (secrets.visible.has(key) || value.length < 4) continue;
    out = out.split(value).join(`{{${key}}}`);
  }
  return out;
}

/** Lines describing what the model may type, for the prompt. Never includes secret values. */
export function describePlaceholders(secrets: SessionSecrets): string {
  return [...secrets.values.keys()]
    .map((key) => (secrets.visible.has(key) ? `{{${key}}} = ${secrets.values.get(key)}` : `{{${key}}} (secret)`))
    .join("\n");
}
