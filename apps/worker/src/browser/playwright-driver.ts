import type { BrowserDriver, PageSnapshot } from "@repo/pipeline";
import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * Playwright implementation of the hands-on BrowserDriver (FR-RES-7). Connects to a remote
 * browser over CDP when BROWSER_WS_ENDPOINT is set, otherwise launches the Chromium installed in
 * the image (Trigger.dev playwright extension) or locally. Popups are closed, dialogs dismissed,
 * downloads refused: the agent works in one tab.
 */

/**
 * Collects visible interactive elements and tags each with data-air-ref. A string, not a function:
 * bundlers may inject helpers into functions that do not exist in the page.
 */
const SNAPSHOT_SCRIPT = String.raw`(() => {
  const MAX = 150;
  const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const nameOf = (el) => {
    const labelled = el.getAttribute("aria-labelledby");
    const byId = labelled ? labelled.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ") : "";
    const label = el.labels && el.labels[0] ? el.labels[0].innerText : "";
    return clip(
      el.getAttribute("aria-label") || byId || label || el.getAttribute("placeholder") || el.getAttribute("title") ||
        el.getAttribute("alt") || el.innerText || (el.tagName === "INPUT" && ["submit", "button"].includes(el.type) ? el.value : "") ||
        el.getAttribute("name") || "",
      100,
    );
  };
  document.querySelectorAll("[data-air-ref]").forEach((e) => e.removeAttribute("data-air-ref"));
  const selector = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [contenteditable=""], [contenteditable="true"]';
  const elements = [];
  let n = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (n >= MAX) break;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const toggle = tag === "input" && (type === "checkbox" || type === "radio");
    // Styled checkboxes hide the input and show the label instead.
    if (!shown(el) && !(toggle && el.labels && el.labels[0] && shown(el.labels[0]))) continue;
    const roleAttr = el.getAttribute("role");
    let role = "other";
    if (tag === "a" || roleAttr === "link") role = "link";
    else if (tag === "button" || roleAttr === "button" || roleAttr === "tab" || roleAttr === "menuitem" || roleAttr === "option" || tag === "summary" || (tag === "input" && ["submit", "button", "reset", "image"].includes(type))) role = "button";
    else if (type === "checkbox" || roleAttr === "checkbox") role = "checkbox";
    else if (type === "radio" || roleAttr === "radio") role = "radio";
    else if (tag === "select") role = "select";
    else if (type === "password") role = "password";
    else if (tag === "input" || tag === "textarea" || el.isContentEditable) role = "textbox";
    const ref = "e" + ++n;
    el.setAttribute("data-air-ref", ref);
    const item = { ref, role, name: nameOf(el), tag };
    if (type) item.type = type;
    const ac = el.getAttribute("autocomplete");
    if (ac) item.autocomplete = ac;
    const field = el.getAttribute("name") || el.id;
    if (field) item.fieldName = clip(field, 60);
    if (tag === "a") item.href = el.href;
    if (role === "textbox" && el.value) item.value = clip(el.value, 80);
    if (role === "checkbox" || role === "radio") item.checked = !!el.checked || el.getAttribute("aria-checked") === "true";
    if (el.required || el.getAttribute("aria-required") === "true") item.required = true;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") item.disabled = true;
    if (tag === "select") item.options = [...el.options].slice(0, 20).map((o) => clip(o.text, 40));
    elements.push(item);
  }
  const frames = [...document.querySelectorAll("iframe")]
    .map((f) => {
      const r = f.getBoundingClientRect();
      return { src: f.src || "", visible: shown(f) && r.width > 30 && r.height > 30, width: Math.round(r.width), height: Math.round(r.height) };
    })
    .filter((f) => f.src);
  const text = (document.body ? document.body.innerText : "").replace(/\n{2,}/g, "\n").slice(0, 6000);
  return { title: document.title, text, elements, frames };
})()`;

export interface PlaywrightDriverOptions {
  wsEndpoint?: string | null;
  executablePath?: string;
  headless?: boolean;
}

export async function createPlaywrightDriver(opts: PlaywrightDriverOptions = {}): Promise<BrowserDriver> {
  // Imported lazily: playwright-core is external to the bundle and only needed for hands-on runs.
  const { chromium } = await import("playwright-core");
  const ws = opts.wsEndpoint === undefined ? process.env.BROWSER_WS_ENDPOINT?.trim() || null : opts.wsEndpoint;
  const launch = async (): Promise<Browser> => {
    try {
      return await chromium.launch({ headless: opts.headless ?? true, executablePath: opts.executablePath });
    } catch (error) {
      // Local runs without `playwright install`: fall back to an installed Google Chrome.
      if (opts.executablePath || !/Executable doesn't exist/.test(String(error))) throw error;
      return chromium.launch({ headless: opts.headless ?? true, channel: "chrome" });
    }
  };
  const browser: Browser = ws ? await chromium.connectOverCDP(ws) : await launch();
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    acceptDownloads: false,
  });
  const page: Page = await context.newPage();
  // One tab only: popups (often OAuth windows) are closed straight away.
  context.on("page", (p) => {
    if (p !== page) void p.close().catch(() => {});
  });
  page.on("dialog", (d) => void d.dismiss().catch(() => {}));

  const settle = async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  };
  const el = (ref: string) => page.locator(`[data-air-ref="${ref.replace(/[^a-z0-9]/gi, "")}"]`).first();

  return {
    async navigate(url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await settle();
    },
    async observe(): Promise<PageSnapshot> {
      const snap = (await page.evaluate(SNAPSHOT_SCRIPT)) as Omit<PageSnapshot, "url">;
      return { url: page.url(), ...snap };
    },
    async click(ref) {
      const target = el(ref);
      try {
        await target.click({ timeout: 10_000 });
      } catch (error) {
        // Visually hidden checkboxes behind a styled label.
        const type = await target.getAttribute("type").catch(() => null);
        if (type !== "checkbox" && type !== "radio") throw error;
        await target.check({ force: true, timeout: 5_000 });
      }
      await settle();
    },
    async type(ref, text) {
      await el(ref).fill(text, { timeout: 10_000 });
    },
    async select(ref, value) {
      const target = el(ref);
      await target
        .selectOption({ label: value }, { timeout: 10_000 })
        .catch(() => target.selectOption(value, { timeout: 10_000 }));
    },
    async press(key) {
      await page.keyboard.press(key);
      await settle();
    },
    async screenshot() {
      return page.screenshot({ type: "png" });
    },
    async wait(ms) {
      await page.waitForTimeout(ms);
    },
    async currentUrl() {
      return page.url();
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
