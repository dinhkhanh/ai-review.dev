import { expect, test } from "@playwright/test";
import { E2E, urls } from "../src/fixtures";

test.describe("public API v1", () => {
  test.use({ baseURL: urls.api });

  test("health", async ({ request }) => {
    const res = await request.get("/v1/health");
    expect(res.ok()).toBe(true);
  });

  test("list reviews and fetch one with its German alternate", async ({ request }) => {
    const list = await request.get("/v1/reviews");
    expect(list.ok()).toBe(true);
    const { data } = (await list.json()) as { data: Array<{ slug: string; locale: string }> };
    expect(data.map((r) => r.slug)).toContain(E2E.acme.reviewSlug);
    // The queued review is not public yet (the CMS spec publishes it later).
    expect(data.map((r) => r.slug)).not.toContain(E2E.beacon.reviewSlug);

    const en = await request.get(`/v1/reviews/${E2E.acme.reviewSlug}`);
    expect(en.ok()).toBe(true);
    const review = (await en.json()) as {
      locale: string;
      blocks: Array<{ type: string }>;
      links: { go: string };
      alternates: Array<{ locale: string; slug: string }>;
    };
    expect(review.locale).toBe("en");
    expect(review.links.go).toBe(E2E.acme.slug);
    expect(review.blocks.map((b) => b.type)).toEqual(
      expect.arrayContaining(["verdict", "pricing_table", "faq", "cta"]),
    );

    const de = review.alternates.find((a) => a.locale === "de");
    expect(de).toBeTruthy();
    const deRes = await request.get(`/v1/reviews/${de!.slug}?locale=de`);
    expect(deRes.ok()).toBe(true);
    expect(((await deRes.json()) as { locale: string; title: string }).locale).toBe("de");
  });

  test("unknown review is a JSON 404", async ({ request }) => {
    const res = await request.get("/v1/reviews/no-such-review");
    expect(res.status()).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
});
