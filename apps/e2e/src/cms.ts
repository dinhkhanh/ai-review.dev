import { expect, type Page } from "@playwright/test";
import { E2E } from "./fixtures";
import { hydrated } from "./hydration";
import { freshTotp } from "./totp";

/**
 * better-auth allows 3 sign-ins per 10 s per client IP; a per-file documentation address (RFC 5737)
 * keeps back-to-back local runs against a long-lived server from tripping it.
 */
export function cmsClientHeaders() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return { "X-Forwarded-For": `198.51.${octet()}.${octet()}` };
}

export async function signIn(page: Page) {
  await page.goto("/login");
  await hydrated(page);
  await page.getByLabel("Email").fill(E2E.admin.email);
  await page.getByLabel("Password").fill(E2E.admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/two-factor$/);
  await hydrated(page);
  await page.getByLabel("Authentication code").fill(await freshTotp(E2E.admin.totpSecret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
}
