import type { HandsOnStopReason } from "@repo/core";
import { getDomain } from "tldts";
import type { PageSnapshot, SnapshotElement } from "./driver";

/**
 * Hard guardrails for the hands-on agent (FR-RES-7). They run in code on every step, whatever the
 * model asks for: the agent stays on the product's own site, never touches payment, CAPTCHA or
 * phone verification, and never starts a paid plan. A tripped blocker ends the session as
 * "blocked" (an expected outcome, not an error); a refused action is reported back to the model.
 */

/** Registrable domain of a URL or host; hosts without one (localhost, IPs) compare as-is. */
export function siteOf(urlOrHost: string): string {
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {
    // already a host
  }
  host = host.toLowerCase().replace(/^\[|\]$/g, "");
  return getDomain(host) ?? host;
}

export function isOnSite(url: string, productSite: string): boolean {
  if (!/^https?:/i.test(url)) return url === "about:blank";
  return siteOf(url) === productSite;
}

/** Third-party sign-in hosts: reaching one means the flow needs an outside account. */
const OAUTH_HOSTS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "github.com",
  "appleid.apple.com",
  "www.facebook.com",
  "facebook.com",
  "www.linkedin.com",
  "linkedin.com",
  "slack.com",
  "auth0.com",
];

export function isOAuthUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OAUTH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const PAYMENT_FRAME =
  /(js\.stripe\.com|checkout\.stripe\.com|stripe\.network|braintreegateway\.com|braintree-api\.com|paddle\.com|paddle\.net|checkout\.com|adyen\.com|recurly\.com|chargebee\.com|paypal\.com|lemonsqueezy\.com|fastspring\.com|2checkout\.com|squareup\.com)/i;
const PAYMENT_URL =
  /\/(checkout|payment|payments|pay|billing\/(?:pay|checkout|upgrade)|purchase|order\/confirm)(?:[/?#]|$)/i;
const PAYMENT_HOST =
  /(checkout\.stripe\.com|buy\.stripe\.com|pay\.paddle\.com|checkout\.paddle\.com|paypal\.com|lemonsqueezy\.com)/i;
const CARD_FIELD =
  /(card.?number|cardnumber|cc-?num|cc-?number|credit.?card|\bcvc\b|\bcvv\b|security.?code|card.?expir|exp(iry|iration)?.?date|cc-?exp|iban|account.?number|routing)/i;
const CARD_AUTOCOMPLETE = /^cc-/i;

const CAPTCHA_FRAME =
  /(recaptcha\/api2\/bframe|recaptcha\/enterprise\/bframe|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs\.com|funcaptcha\.com|geo\.captcha-delivery\.com|captcha)/i;
const CAPTCHA_TEXT =
  /(verify (that )?you are (a )?human|i'?m not a robot|complete the (security )?(check|challenge)|captcha)/i;

const PHONE_TEXT =
  /(verify your (phone|mobile)|confirm your (phone|mobile)|(code|sms) (was )?sent to your (phone|mobile)|enter the code (we )?(texted|sent by sms|sent via sms)|sms verification|phone verification|add your phone number to continue)/i;
const PHONE_FIELD = /(phone|mobile|tel\b|msisdn)/i;

/** Button/link names that would start a paid plan. Trials are fine; buying is not. */
const PAID_ACTION =
  /\b(buy( now)?|purchase|pay( now)?|place order|complete (purchase|order|payment)|checkout|subscribe now|upgrade( now| plan| to)?|add (a )?(payment( method)?|credit card|debit card|card details|billing (details|info))|enter (payment|card)|start (paid|subscription))\b/i;

export interface Blocker {
  reason: HandsOnStopReason;
  detail: string;
}

function isCardField(el: SnapshotElement): boolean {
  if (el.autocomplete && CARD_AUTOCOMPLETE.test(el.autocomplete)) return true;
  if (el.role !== "textbox" && el.role !== "password" && el.role !== "select") return false;
  return CARD_FIELD.test(`${el.name} ${el.fieldName ?? ""}`);
}

function isPhoneField(el: SnapshotElement): boolean {
  return (
    (el.role === "textbox" && el.type === "tel") ||
    (el.role === "textbox" && el.autocomplete === "tel") ||
    (el.role === "textbox" && PHONE_FIELD.test(`${el.name} ${el.fieldName ?? ""}`))
  );
}

/** Visible CAPTCHA challenges only: invisible reCAPTCHA v3 badges and hidden widgets do not count. */
function visibleCaptcha(snap: PageSnapshot): string | null {
  for (const frame of snap.frames) {
    if (!frame.visible || !CAPTCHA_FRAME.test(frame.src)) continue;
    if (/recaptcha/i.test(frame.src) && /size=invisible/i.test(frame.src)) continue;
    return frame.src;
  }
  return null;
}

/**
 * Checks the current page. Returns the reason the session must stop, or null. `productSite` is the
 * registrable domain the agent may act on.
 */
export function detectBlocker(snap: PageSnapshot, productSite: string): Blocker | null {
  if (isOAuthUrl(snap.url))
    return { reason: "oauth_only", detail: `Reached a third-party sign-in page (${new URL(snap.url).hostname})` };
  if (PAYMENT_HOST.test(snap.url))
    return { reason: "payment_required", detail: `Reached a hosted checkout (${snap.url})` };
  if (/^https?:/i.test(snap.url) && !isOnSite(snap.url, productSite)) {
    return { reason: "off_domain", detail: `Left ${productSite} for ${siteOf(snap.url)}` };
  }
  const card = snap.elements.find(isCardField);
  if (card)
    return { reason: "payment_required", detail: `Payment field on the page: "${card.name || card.fieldName}"` };
  const payFrame = snap.frames.find((f) => f.visible && PAYMENT_FRAME.test(f.src));
  if (payFrame)
    return { reason: "payment_required", detail: `Payment widget on the page (${new URL(payFrame.src).hostname})` };
  try {
    if (PAYMENT_URL.test(new URL(snap.url).pathname)) {
      return { reason: "payment_required", detail: `Checkout or payment page (${new URL(snap.url).pathname})` };
    }
  } catch {
    // not a URL
  }
  const captcha = visibleCaptcha(snap);
  if (captcha) return { reason: "captcha", detail: "CAPTCHA challenge on the page" };
  if (CAPTCHA_TEXT.test(snap.text) && snap.text.length < 3000) {
    return { reason: "captcha", detail: "The page asks to prove a human is present" };
  }
  if (PHONE_TEXT.test(snap.text))
    return { reason: "phone_verification", detail: "The page asks for phone or SMS verification" };
  return null;
}

/** Why an action is refused (sent back to the model), or null when allowed. */
export function refuseClick(el: SnapshotElement | undefined, productSite: string): string | null {
  if (!el) return "Unknown element ref: observe the page again and use a ref from the latest list.";
  if (el.disabled) return "That element is disabled.";
  if (PAID_ACTION.test(el.name) && !/\b(free|trial)\b/i.test(el.name)) {
    return `Refused: "${el.name}" looks like it starts a paid plan or payment. Only free plans and free trials are allowed.`;
  }
  if (el.href && /^https?:/i.test(el.href) && !isOnSite(el.href, productSite)) {
    if (isOAuthUrl(el.href))
      return "Refused: third-party sign-in (Google, Microsoft, GitHub…) is not allowed. Use the email sign-up form, or stop with oauth_only.";
    return `Refused: the link leaves ${productSite} (${siteOf(el.href)}).`;
  }
  return null;
}

/** Card-number-like digit runs (13–19 digits passing Luhn): never typed anywhere. */
export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function refuseType(el: SnapshotElement | undefined, value: string): string | null {
  if (!el) return "Unknown element ref: observe the page again and use a ref from the latest list.";
  if (!["textbox", "password", "other"].includes(el.role))
    return `Element ${el.ref} is a ${el.role}, not a text field.`;
  if (isCardField(el)) return "Refused: payment fields are never filled.";
  if (isPhoneField(el))
    return "Refused: we have no phone number and never invent one. If a phone number is required, stop with phone_verification.";
  if (looksLikeCardNumber(value)) return "Refused: the value looks like a card number.";
  return null;
}

/** Navigation by the model: on-site http(s) only. */
export function refuseNavigate(url: string, productSite: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Refused: not an absolute URL.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "Refused: only http(s) URLs.";
  if (!isOnSite(url, productSite)) return `Refused: ${parsed.hostname} is not on ${productSite}.`;
  if (PAYMENT_URL.test(parsed.pathname)) return "Refused: checkout and payment pages are off limits.";
  return null;
}
