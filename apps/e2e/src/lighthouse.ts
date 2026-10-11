/**
 * Lighthouse budgets on the seeded site (FR-WEB-3, SRS §8 #4): mobile emulation with simulated
 * throttling (Lighthouse defaults), run in Playwright's bundled Chromium over CDP.
 *
 *   pnpm --filter e2e lighthouse            # against E2E_SITE_URL / NEXT_PUBLIC_SITE_URL
 *   LH_MIN_PERF=80 pnpm --filter e2e lighthouse
 *
 * Reports go to apps/e2e/lighthouse-report/. Exits non-zero when a budget fails.
 */
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { E2E, urls } from "./fixtures";

const BUDGETS: Record<string, number> = {
  performance: Number(process.env.LH_MIN_PERF ?? 90),
  accessibility: 95,
  seo: 95,
  "best-practices": 90,
};
const PAGES = [
  { name: "review", path: `/reviews/${E2E.acme.reviewSlug}` },
  { name: "home", path: "/" },
];
const RUNS = Math.max(1, Number(process.env.LH_RUNS ?? 1));
const outDir = fileURLToPath(new URL("../lighthouse-report/", import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const port = await freePort();
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  const failures: string[] = [];
  const summary: Record<string, Record<string, number>> = {};
  try {
    for (const p of PAGES) {
      const url = new URL(p.path, urls.site).toString();
      // Best of N runs per category smooths out CI noise; each run is a fresh Lighthouse navigation.
      const best: Record<string, number> = {};
      for (let i = 0; i < RUNS; i++) {
        const result = await lighthouse(url, {
          port,
          output: ["json", "html"],
          logLevel: "error",
          onlyCategories: Object.keys(BUDGETS),
        });
        if (!result) throw new Error(`Lighthouse returned no result for ${url}`);
        const [json, html] = result.report as string[];
        writeFileSync(`${outDir}${p.name}${RUNS > 1 ? `-${i + 1}` : ""}.report.json`, json!);
        writeFileSync(`${outDir}${p.name}${RUNS > 1 ? `-${i + 1}` : ""}.report.html`, html!);
        if (result.lhr.runtimeError) throw new Error(`${url}: ${result.lhr.runtimeError.message}`);
        for (const [key, cat] of Object.entries(result.lhr.categories)) {
          best[key] = Math.max(best[key] ?? 0, Math.round((cat.score ?? 0) * 100));
        }
      }
      summary[p.name] = best;
      for (const [key, min] of Object.entries(BUDGETS)) {
        const score = best[key] ?? 0;
        if (score < min) failures.push(`${p.name}: ${key} ${score} < ${min}`);
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(`${outDir}summary.json`, JSON.stringify({ budgets: BUDGETS, summary }, null, 2));
  console.table(summary);
  if (failures.length) {
    console.error(`Lighthouse budgets failed:\n  ${failures.join("\n  ")}\nReports: ${outDir}`);
    process.exit(1);
  }
  console.log(`Lighthouse budgets met. Reports: ${outDir}`);
}

await main();
