import { expect, test } from "@playwright/test";
import { E2E, urls } from "../src/fixtures";
import { cmsClientHeaders, signIn } from "../src/cms";
import { hydrated } from "../src/hydration";

test.use({ baseURL: urls.cms, extraHTTPHeaders: cmsClientHeaders() });
// One admin session drives the publish flow; keep these steps in order.
test.describe.configure({ mode: "serial" });

test("CMS refuses unauthenticated access and wrong 2FA codes", async ({ page }) => {
  await page.goto("/articles");
  await expect(page).toHaveURL(/\/login/);
  await hydrated(page);
  await page.getByLabel("Email").fill(E2E.admin.email);
  await page.getByLabel("Password").fill(E2E.admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/two-factor$/);
  await hydrated(page);
  await page.getByLabel("Authentication code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/two-factor$/);
});

test("login with password + TOTP, approve and publish the queued review, page goes live", async ({ page, request }) => {
  await signIn(page);
  await expect(page.getByRole("region", { name: "Key numbers" })).toContainText("Awaiting review");

  await page.goto("/articles");
  const row = page.getByRole("row").filter({ hasText: E2E.beacon.name });
  await expect(row).toContainText("in review");
  await row.getByRole("link", { name: "Open" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(E2E.beacon.name);

  // Not live before publishing. Requesting the web page also primes its ISR entry as a 404, so the
  // 200 below proves the publish revalidated it (FR-WEB-2) rather than a first render.
  expect((await request.get(`${urls.api}/v1/reviews/${E2E.beacon.reviewSlug}`)).status()).toBe(404);
  expect((await request.get(`${urls.site}/reviews/${E2E.beacon.reviewSlug}`)).status()).toBe(404);

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  // The page re-renders with the approved state's actions.
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByRole("link", { name: `/reviews/${E2E.beacon.reviewSlug}` })).toBeVisible();

  // SRS §8 #2: the page is live within 60 s.
  await expect
    .poll(async () => (await request.get(`${urls.site}/reviews/${E2E.beacon.reviewSlug}`)).status(), {
      timeout: 60_000,
    })
    .toBe(200);
  const live = await page.context().newPage();
  await live.goto(`${urls.site}/reviews/${E2E.beacon.reviewSlug}`);
  await expect(live.getByRole("heading", { level: 1 })).toContainText(E2E.beacon.name);
  await expect(live.locator('a[href^="/go/beacon-notes"]').first()).toHaveAttribute("rel", /sponsored/);
});
