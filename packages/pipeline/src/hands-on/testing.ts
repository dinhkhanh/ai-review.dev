import type { GenerateOptions, Llm } from "@repo/ai";
import type { z } from "zod";
import type { BrowserDriver, PageSnapshot, SnapshotElement } from "./driver";

/**
 * Test doubles for the hands-on agent: a scripted fake site behind the BrowserDriver interface and
 * a fake LLM that answers from a policy function. Used by unit tests only.
 */

export interface FakePage {
  title: string;
  text: string;
  elements: Array<Omit<SnapshotElement, "ref"> & { id: string; to?: string }>;
  frames?: PageSnapshot["frames"];
}

/**
 * A tiny site: clicking an element with `to` navigates there; `onClick` hooks can redirect based on
 * typed values. Records everything typed (so tests can assert secrets were substituted).
 */
export function fakeSite(
  pages: Record<string, FakePage>,
  opts: { start?: string; onClick?: (url: string, id: string, typed: Map<string, string>) => string | null } = {},
): BrowserDriver & { typed: Map<string, string>; visited: string[]; closed: boolean } {
  let url = opts.start ?? Object.keys(pages)[0]!;
  const typed = new Map<string, string>();
  const visited: string[] = [];
  let refs = new Map<string, string>();
  const page = () => pages[url.replace(/[?#].*$/, "")];
  const driver = {
    typed,
    visited,
    closed: false,
    async navigate(next: string) {
      url = next;
      visited.push(next);
    },
    async observe(): Promise<PageSnapshot> {
      const p = page();
      refs = new Map();
      const elements = (p?.elements ?? []).map((el, i) => {
        const ref = `e${i + 1}`;
        refs.set(ref, el.id);
        const { id: _id, to: _to, ...rest } = el;
        return { ...rest, ref, value: rest.role === "password" ? undefined : typed.get(el.id) };
      });
      return { url, title: p?.title ?? "Not found", text: p?.text ?? "404", elements, frames: p?.frames ?? [] };
    },
    async click(ref: string) {
      const id = refs.get(ref);
      const el = page()?.elements.find((e) => e.id === id);
      if (!el) throw new Error(`no element ${ref}`);
      const redirect = opts.onClick?.(url, el.id, typed);
      const to = redirect ?? el.to;
      if (to) await driver.navigate(new URL(to, url).toString());
    },
    async type(ref: string, text: string) {
      const id = refs.get(ref);
      if (!id) throw new Error(`no element ${ref}`);
      typed.set(id, text);
    },
    async select(ref: string, value: string) {
      typed.set(refs.get(ref) ?? ref, value);
    },
    async press() {},
    async screenshot() {
      return Buffer.from(`png:${url}`);
    },
    async wait() {},
    async currentUrl() {
      return url;
    },
    async close() {
      driver.closed = true;
    },
  };
  return driver;
}

/** Fake LLM: `decide(operation, prompt)` returns the structured data for each call. */
export function fakeAgentLlm(decide: (operation: string, prompt: string) => unknown, costPerCall = 0.01) {
  const calls: Array<{ operation: string; prompt: string }> = [];
  const llm = {
    generate: async () => {
      throw new Error("not used");
    },
    generateStructured: async <S extends z.ZodType>(o: GenerateOptions & { schema: S }) => {
      calls.push({ operation: o.operation, prompt: o.prompt ?? "" });
      const data = o.schema.parse(decide(o.operation, o.prompt ?? ""));
      return {
        data,
        text: JSON.stringify(data),
        model: o.model,
        stopReason: "end_turn",
        fallbackUsed: false,
        cost: {
          costUsd: costPerCall,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          models: [o.model],
          unpricedModels: [],
        },
        raw: {} as never,
      };
    },
  } as unknown as Llm;
  return { llm, calls };
}

/** Element ref of the first element on the current page whose name matches. */
export function refFor(prompt: string, name: RegExp): string {
  for (const line of prompt.split("\n")) {
    const m = /^\[(e\d+)\] \w+ "([^"]*)"/.exec(line);
    if (m && name.test(m[2]!)) return m[1]!;
  }
  return "";
}

export function currentUrl(prompt: string): string {
  return /^URL: (.*)$/m.exec(prompt)?.[1] ?? "";
}
