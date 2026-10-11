import { expect, test, type Page } from "@playwright/test";
import { E2E } from "../src/fixtures";
import { hydrated } from "../src/hydration";

const REVIEW = `/reviews/${E2E.acme.reviewSlug}`;

type JsonLd = Record<string, unknown> & { "@type"?: string };

async function jsonLd(page: Page): Promise<JsonLd[]> {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
  return raw.flatMap((text) => {
    const parsed = JSON.parse(text) as JsonLd | JsonLd[];
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

/**
 * Public form posts are rate limited per client IP (NFR-7). Give each form test its own documentation
 * address (RFC 5737) so repeated local runs against a long-lived server never hit the limit.
 */
async function freshVisitor(page: Page) {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  await page.setExtraHTTPHeaders({ "X-Forwarded-For": `203.0.${octet()}.${octet()}` });
}

test.describe("public site", () => {
  test("home → category → review", async ({ page, isMobile }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page
      .getByRole("link", { name: /Developer Tools/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/categories\/developer-tools$/);
    await page.locator(`main a[href="${REVIEW}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${REVIEW}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(E2E.acme.name);
    if (isMobile) {
      // Sticky bottom CTA on mobile (FR-WEB-5).
      await expect(page.locator(`a[href*="p=sticky_mobile"]`)).toBeVisible();
    }
  });

  test("review page: disclosure before the first CTA, sponsored go-links, SEO tags", async ({ page }) => {
    await page.goto(REVIEW);
    const disclosure = page.getByRole("note").filter({ hasText: "Disclosure:" }).first();
    await expect(disclosure).toBeVisible();
    await expect(disclosure.getByRole("link", { name: "How we make money" })).toHaveAttribute(
      "href",
      "/affiliate-disclosure",
    );

    const goLinks = page.locator('a[href^="/go/"]');
    expect(await goLinks.count()).toBeGreaterThanOrEqual(3);
    for (const link of await goLinks.all()) {
      const href = (await link.getAttribute("href"))!;
      expect(href).toMatch(new RegExp(`^/go/${E2E.acme.slug}\\?p=[a-z_]+&a=${E2E.acme.reviewSlug}$`));
      expect((await link.getAttribute("rel"))!.split(/\s+/)).toContain("sponsored");
    }
    // FR-AFF-14: the disclosure precedes every monetised link in document order.
    const disclosureFirst = await page.evaluate(() => {
      const note = [...document.querySelectorAll('[role="note"]')].find((n) => n.textContent?.includes("Disclosure:"));
      const first = document.querySelector('a[href^="/go/"]');
      return !!note && !!first && !!(note.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(disclosureFirst).toBe(true);

    await expect(page.getByText(/verified/i).first()).toBeVisible(); // FR-WEB-6
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${REVIEW}$`));
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{50,}/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Acme Tracker/);
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(ogImage, "og:image").toBeTruthy();
    const og = await page.request.get(ogImage!);
    expect(og.ok()).toBe(true);
    expect(og.headers()["content-type"]).toMatch(/^image\//);
    await expect(page.locator('link[rel="alternate"][hreflang="de"]')).toHaveAttribute("href", /\/de\/reviews\//);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
      "href",
      new RegExp(`${REVIEW}$`),
    );
  });

  test("review page: structured data is valid and never fabricates user ratings", async ({ page }) => {
    await page.goto(REVIEW);
    const items = await jsonLd(page);
    const types = items.map((i) => i["@type"]);
    expect(types).toEqual(expect.arrayContaining(["FAQPage", "BreadcrumbList"]));

    const product = items.find((i) => i["@type"] === "SoftwareApplication" || i["@type"] === "Product");
    expect(product, "Product/SoftwareApplication JSON-LD").toBeTruthy();
    expect(product!.name).toBe(E2E.acme.name);
    const review = product!.review as JsonLd;
    expect(review["@type"]).toBe("Review");
    expect((review.author as JsonLd).name).toBe("Erin Editor");
    expect(review.reviewRating).toMatchObject({ "@type": "Rating", ratingValue: 8.2, bestRating: 10 });

    // FR-CON-9: our own rating only, no invented user counts.
    const all = JSON.stringify(items);
    expect(all).not.toMatch(/"(reviewCount|ratingCount)"/);
    if (product!.aggregateRating) {
      expect(product!.aggregateRating).not.toHaveProperty("ratingCount");
    }
    const faq = items.find((i) => i["@type"] === "FAQPage")!;
    expect((faq.mainEntity as JsonLd[])[0]).toMatchObject({ "@type": "Question", name: "Is there a free plan?" });
    const crumbs = items.find((i) => i["@type"] === "BreadcrumbList")!;
    expect((crumbs.itemListElement as JsonLd[]).map((c) => c.position)).toEqual([1, 2, 3]);
  });

  test("go-link: affiliate URL with SubID, vendor fallback with UTM, unknown slug 404", async ({ request }) => {
    const opts = { maxRedirects: 0, headers: { "User-Agent": "Mozilla/5.0 (e2e) Chrome/140" } };
    const affiliate = await request.get(`/go/${E2E.acme.slug}?p=verdict&a=${E2E.acme.reviewSlug}`, opts);
    expect(affiliate.status()).toBe(302);
    expect(affiliate.headers()["cache-control"]).toContain("no-store");
    const to = new URL(affiliate.headers().location!);
    expect(to.origin + to.pathname).toBe(E2E.acme.affiliateUrl);
    expect(to.searchParams.get(E2E.acme.referralParam)).toBe(E2E.acme.referralValue);
    expect(to.searchParams.get(E2E.acme.subIdParam)).toContain(E2E.acme.reviewSlug);
    expect(to.searchParams.get(E2E.acme.subIdParam)).toContain("verdict");

    const fallback = await request.get(`/go/${E2E.beacon.slug}?p=inline`, opts);
    expect(fallback.status()).toBe(302);
    const vendor = new URL(fallback.headers().location!);
    expect(vendor.origin).toBe(E2E.beacon.website);
    expect(vendor.searchParams.get("utm_source")).toBeTruthy();
    expect(vendor.searchParams.get("utm_medium")).toBe("referral");

    const missing = await request.get("/go/does-not-exist", opts);
    expect(missing.status()).toBe(404);
  });

  test("search finds the product", async ({ page }) => {
    await page.goto("/search?q=acme");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("acme");
    await expect(page.locator(`main a[href="${REVIEW}"]`).first()).toBeVisible();
    // The header search box submits to the same page.
    await page.goto("/search?q=zzzz-no-such-product");
    await expect(page.locator(`main a[href="${REVIEW}"]`)).toHaveCount(0);
  });

  test("helpful vote records and thanks in place", async ({ page }) => {
    await freshVisitor(page);
    await page.goto(REVIEW);
    const vote = page.getByRole("group", { name: "Was this review helpful?" });
    await hydrated(page, vote);
    await vote.getByRole("button", { name: "Yes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Thanks for the feedback." })).toBeVisible();
  });

  test("report-a-change form lands on the thanks page", async ({ page }) => {
    await freshVisitor(page);
    await page.goto(`/report?article=${E2E.acme.reviewSlug}`);
    await page.getByLabel("What changed?").selectOption("pricing");
    await page.getByLabel("Details").fill("The Plus plan now costs $14 per user per month.");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page).toHaveURL(/\/report\/thanks/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thanks, we got it");
  });

  test("newsletter sign-up asks to confirm by email", async ({ page }, info) => {
    await freshVisitor(page);
    await page.goto("/");
    await page.getByLabel("Weekly email: new and updated reviews").fill(`e2e+${info.project.name}@example.com`);
    await page.getByRole("button", { name: "Subscribe" }).click();
    await expect(page).toHaveURL(/\/newsletter\/thanks$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your inbox");
  });

  test("public pages set no cookies (cookieless analytics, no consent banner needed)", async ({ page, context }) => {
    // FR-WEB-11: click logging and analytics are cookieless, so there is nothing to consent to.
    await page.goto("/");
    await page.goto(REVIEW);
    await page.goto("/de");
    expect(await context.cookies()).toEqual([]);
  });

  test("German review renders under /de with hreflang and the language switcher", async ({ page }) => {
    await page.goto(REVIEW);
    // The switcher lives in the header nav; on mobile it is the same list.
    await page
      .getByRole("list", { name: /Language/ })
      .getByRole("link", { name: "de" })
      .click();
    await expect(page).toHaveURL(/\/de\/reviews\/acme-tracker-test-2026/);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(E2E.acme.deReviewTitle);
    await expect(page.getByRole("note").filter({ hasText: "Hinweis:" }).first()).toBeVisible();
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      "href",
      new RegExp(`${REVIEW}$`),
    );
    // German practice: affiliate links are marked as ads.
    await expect(page.locator('a[href^="/go/"]').first()).toBeVisible();
    // And back to English.
    await page
      .getByRole("list", { name: /Sprache|Language/ })
      .getByRole("link", { name: "en" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${REVIEW}$`));
  });

  test("comparison and deals pages render", async ({ page }) => {
    await page.goto(`/compare/${E2E.comparisonSlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("vs");
    await expect(page.getByRole("table").first()).toContainText("Plus price");
    await page.goto("/deals");
    await expect(page.getByText(E2E.acme.dealCode).first()).toBeVisible();
  });

  test("unknown pages return a real 404", async ({ page }) => {
    const res = await page.goto("/reviews/no-such-review");
    expect(res?.status()).toBe(404);
    // Every robots directive says noindex (no conflicting "index, follow" from the layout).
    const robots = await page
      .locator('meta[name="robots"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("content")));
    expect(robots.length).toBeGreaterThan(0);
    for (const content of robots) expect(content).toMatch(/noindex/);
  });

  test("robots, sitemaps and RSS respond", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toMatch(/Sitemap: .*\/sitemap\.xml/);

    const index = await request.get("/sitemap.xml");
    expect(index.ok()).toBe(true);
    const sitemaps = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    expect(sitemaps).toContain("/sitemaps/reviews.xml");
    const reviews = await (await request.get("/sitemaps/reviews.xml")).text();
    expect(reviews).toContain(REVIEW);
    expect(reviews).toContain("/de/reviews/");

    const rss = await request.get("/feed.xml");
    expect(rss.ok()).toBe(true);
    expect(rss.headers()["content-type"]).toMatch(/xml/);
    expect(await rss.text()).toContain(E2E.acme.name);
  });
});
