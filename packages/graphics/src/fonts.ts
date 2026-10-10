import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type Font = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };
let fontsPromise: Promise<Font[]> | null = null;

/** Inter regular + bold from @fontsource, loaded once per process. */
export function loadFonts(): Promise<Font[]> {
  fontsPromise ??= Promise.all([
    readFile(require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff")),
    readFile(require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff")),
  ]).then(([regular, bold]) => [
    { name: "Inter", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Inter", data: bold, weight: 700 as const, style: "normal" as const },
  ]);
  return fontsPromise;
}
