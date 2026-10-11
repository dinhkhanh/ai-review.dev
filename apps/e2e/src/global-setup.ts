import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { urls } from "./fixtures";

/**
 * Re-seeds the e2e database (unless E2E_SKIP_SEED=1) and drops every cached ISR page, so each run
 * starts from the same catalogue even when the servers were reused from a previous run.
 */
export default async function globalSetup() {
  if (process.env.E2E_SKIP_SEED !== "1") {
    execFileSync(process.execPath, ["--import", "tsx", "src/seed.ts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "inherit",
      env: process.env,
    });
  }
  const res = await fetch(`${urls.site}/api/revalidate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.REVALIDATE_SECRET ?? "e2e-revalidate-secret"}`,
      "Content-Type": "application/json",
    },
    // `all` covers every page under the locale layout; sitemaps and feeds live outside it.
    body: JSON.stringify({
      all: true,
      paths: [
        "/sitemap.xml",
        "/sitemaps/pages.xml",
        "/sitemaps/reviews.xml",
        "/sitemaps/guides.xml",
        "/sitemaps/categories.xml",
        "/feed.xml",
        "/de/feed.xml",
      ],
    }),
  });
  if (!res.ok) throw new Error(`Revalidation after seeding failed: ${res.status} (REVALIDATE_SECRET mismatch?)`);
}
