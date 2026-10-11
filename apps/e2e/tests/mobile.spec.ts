import { expect, test } from "@playwright/test";
import { cmsClientHeaders, signIn } from "../src/cms";
import { E2E, urls } from "../src/fixtures";
import { expectNoHorizontalOverflow } from "../src/layout";

/** Every public template with seeded content; none may scroll sideways on a 360 px phone. */
const PUBLIC = [
  "/",
  "/reviews",
  `/reviews/${E2E.acme.reviewSlug}`,
  `/categories/${E2E.category}`,
  `/compare/${E2E.comparisonSlug}`,
  "/compare",
  "/alternatives",
  "/best",
  "/deals",
  "/search?q=acme",
  `/report?article=${E2E.acme.reviewSlug}`,
  "/about",
  "/editorial-policy",
  "/affiliate-disclosure",
  "/privacy",
  "/contact",
  "/de",
  `/de/reviews/${E2E.acme.reviewSlug}`,
  "/no-such-page",
];

for (const path of PUBLIC) {
  test(`public ${path} fits the screen`, async ({ page }) => {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  });
}

/** CMS screens an editor opens from a phone; detail pages are reached through their list's first link. */
const CMS = [
  "/",
  "/intake",
  "/suggestions",
  "/jobs",
  "/articles",
  "/products",
  "/affiliate",
  "/deals",
  "/analytics",
  "/decay",
  "/translations",
  "/newsletter",
  "/hands-on",
  "/mobile",
  "/media",
  "/reports",
  "/notifications",
  "/launch",
  "/settings",
  "/vault",
  "/audit",
];
const DETAIL = [
  { list: "/articles", href: /^\/articles\/[^/]+$/ },
  { list: "/products", href: /^\/products\/[^/]+$/ },
  { list: "/jobs", href: /^\/jobs\/[^/]+$/ },
];

test.describe("CMS", () => {
  test.use({ baseURL: urls.cms, extraHTTPHeaders: cmsClientHeaders() });

  test("every screen fits the screen", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    for (const path of CMS) {
      await test.step(path, async () => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
    for (const { list, href } of DETAIL) {
      await test.step(`${list}/[id]`, async () => {
        await page.goto(list);
        const hrefs = await page.locator("main a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
        const detail = hrefs.find((h) => href.test(h));
        if (!detail) return;
        await page.goto(detail);
        await expectNoHorizontalOverflow(page);
      });
    }
  });
});
