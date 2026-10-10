/**
 * The browser as the hands-on agent sees it (FR-RES-7). The agent loop only talks to this
 * interface; apps/worker implements it with Playwright and tests use a scripted fake.
 */

export type ElementRole = "link" | "button" | "textbox" | "password" | "checkbox" | "radio" | "select" | "other";

/** One interactive element, addressed by a ref that is valid until the next `observe()`. */
export interface SnapshotElement {
  ref: string;
  role: ElementRole;
  /** Accessible name: aria-label, label text, inner text, placeholder or alt (trimmed). */
  name: string;
  tag: string;
  /** Input type for inputs. */
  type?: string;
  autocomplete?: string;
  /** name/id attributes (help detect card or phone fields). */
  fieldName?: string;
  href?: string;
  /** Current value for non-secret fields, clipped. Never set for password fields. */
  value?: string;
  checked?: boolean;
  required?: boolean;
  disabled?: boolean;
  options?: string[];
}

export interface SnapshotFrame {
  src: string;
  /** Rendered on screen with a usable size (hidden/invisible widgets are false). */
  visible: boolean;
  width?: number;
  height?: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Visible text of the page, clipped. */
  text: string;
  elements: SnapshotElement[];
  frames: SnapshotFrame[];
}

export interface BrowserDriver {
  navigate(url: string): Promise<void>;
  observe(): Promise<PageSnapshot>;
  click(ref: string): Promise<void>;
  /** Types into an input (replacing its content). */
  type(ref: string, text: string): Promise<void>;
  select(ref: string, value: string): Promise<void>;
  /** Presses a key on the focused element, e.g. "Enter" or "Tab". */
  press(key: string): Promise<void>;
  /** PNG of the visible viewport. */
  screenshot(): Promise<Buffer>;
  wait(ms: number): Promise<void>;
  currentUrl(): Promise<string>;
  close(): Promise<void>;
}

export type BrowserFactory = () => Promise<BrowserDriver>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Compact text form of a snapshot for the model: one line per element. */
export function renderSnapshot(snap: PageSnapshot, opts: { maxElements?: number; maxText?: number } = {}): string {
  const maxElements = opts.maxElements ?? 120;
  const lines = snap.elements.slice(0, maxElements).map((el) => {
    const attrs = [
      el.type && el.role !== "password" ? `type=${el.type}` : null,
      el.autocomplete ? `autocomplete=${el.autocomplete}` : null,
      el.required ? "required" : null,
      el.disabled ? "disabled" : null,
      el.checked !== undefined ? (el.checked ? "checked" : "unchecked") : null,
      el.value ? `value="${clip(el.value, 60)}"` : null,
      el.href ? `href=${clip(el.href, 100)}` : null,
      el.options?.length
        ? `options=[${el.options
            .slice(0, 12)
            .map((o) => clip(o, 30))
            .join(" | ")}]`
        : null,
    ].filter(Boolean);
    return `[${el.ref}] ${el.role} "${clip(el.name, 80)}"${attrs.length ? ` (${attrs.join(", ")})` : ""}`;
  });
  const more = snap.elements.length > maxElements ? `\n… ${snap.elements.length - maxElements} more elements` : "";
  const frames = snap.frames.filter((f) => f.visible).map((f) => `- iframe ${clip(f.src, 120)}`);
  return [
    `URL: ${snap.url}`,
    `Title: ${snap.title}`,
    "Interactive elements:",
    lines.join("\n") || "(none)",
    more,
    frames.length ? `Visible embedded frames:\n${frames.join("\n")}` : "",
    "Visible text:",
    clip(snap.text, opts.maxText ?? 4000),
  ]
    .filter(Boolean)
    .join("\n");
}
