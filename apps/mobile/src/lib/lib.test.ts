import { blockSchema, type Block } from "@repo/content";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createMobileApi } from "./api";
import {
  comparisonHeaders,
  formatScore,
  formatTierPrice,
  hasMonetisedLinks,
  inlineSegments,
  numberSources,
  RENDERED_BLOCK_TYPES,
} from "./blocks";
import { catalogue, MESSAGE_KEYS, pickLocale, translate } from "./i18n";
import { appRoute, goLinkUrl, parseAppUrl, redirectSystemPath, webArticleUrl } from "./links";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

describe("block helpers", () => {
  it("renders every block type in the content schema", () => {
    const schemaTypes = blockSchema.options.map((o) => o.shape.type.value);
    expect([...RENDERED_BLOCK_TYPES].sort()).toEqual([...schemaTypes].sort());
  });

  it("flattens inline marks and numbers citations by first use", () => {
    const blocks: Block[] = [
      {
        id: "p",
        type: "paragraph",
        children: [
          { text: "Fast ", marks: [{ type: "bold" }] },
          { text: "pricing", marks: [{ type: "citation", citation: { sourceId: S2 } }] },
          { text: " — try it", marks: [{ type: "golink", slug: "notion", placement: "inline" }] },
        ],
      },
    ];
    const numbers = numberSources(blocks, [S1, S2]);
    expect(numbers.get(S2)).toBe(1);
    expect(numbers.get(S1)).toBe(2);
    const segs = inlineSegments((blocks[0] as Extract<Block, { type: "paragraph" }>).children, numbers);
    expect(segs).toEqual([
      { text: "Fast ", bold: true },
      { text: "pricing" },
      { text: "", citation: 1 },
      { text: " — try it", goSlug: "notion" },
    ]);
    expect(hasMonetisedLinks(blocks)).toBe(true);
    expect(hasMonetisedLinks([{ id: "h", type: "heading", level: 2, text: "x" }])).toBe(false);
  });

  it("formats scores, prices and comparison headers", () => {
    expect(formatScore(8.25)).toBe("8.3");
    expect(formatScore(null)).toBeNull();
    expect(formatTierPrice({ price: 12, currency: "USD", period: "month" }, "en")).toBe("$12/mo");
    expect(formatTierPrice({ price: 0, currency: "USD", period: "month" }, "de")).toBe("Kostenlos");
    expect(formatTierPrice({ price: 9.5, currency: "EUR", period: "year" }, "de").replace(/\s/g, " ")).toBe(
      "9,50 €/Jahr",
    );
    expect(formatTierPrice({ price: null, currency: "USD", period: "custom" }, "en")).toBe("Custom");
    expect(comparisonHeaders([S1, S2], [{ id: S2, name: "Coda" }])).toEqual(["Product 1", "Coda"]);
  });
});

describe("i18n", () => {
  it("has a German string for every key and picks the device language", () => {
    for (const key of MESSAGE_KEYS) expect(catalogue("de")[key], key).toBeTypeOf("string");
    expect(pickLocale(["de-AT", "en-US"])).toBe("de");
    expect(pickLocale(["fr-FR"])).toBe("en");
    expect(pickLocale([])).toBe("en");
    expect(translate("en", "search.empty", { q: "crm" })).toBe("No results for “crm”.");
  });
});

describe("deep links", () => {
  it("parses scheme and universal links, including German paths", () => {
    expect(parseAppUrl("aireview://reviews/notion-review")).toEqual({
      type: "review",
      slug: "notion-review",
      locale: "en",
    });
    expect(parseAppUrl("aireview://reviews/notion-review?locale=de")?.locale).toBe("de");
    expect(parseAppUrl("https://ai-review.dev/de/compare/notion-vs-coda")).toEqual({
      type: "comparison",
      slug: "notion-vs-coda",
      locale: "de",
    });
    expect(parseAppUrl("https://ai-review.dev/best/crm")?.type).toBe("best_of");
    expect(parseAppUrl("https://ai-review.dev/about")).toBeNull();
    expect(parseAppUrl("https://ai-review.dev/reviews/../etc")).toBeNull();
    expect(parseAppUrl("not a url")).toBeNull();
  });

  it("maps system paths to app routes", () => {
    expect(redirectSystemPath("/de/reviews/notion-review")).toBe("/reviews/notion-review?locale=de");
    expect(redirectSystemPath("/alternatives/notion-alternatives")).toBe("/guides/alternatives/notion-alternatives");
    expect(redirectSystemPath("aireview://best/crm")).toBe("/guides/best_of/crm");
    expect(redirectSystemPath("/reviews/x/y")).toBe("/");
    expect(redirectSystemPath("/")).toBe("/");
    expect(appRoute({ type: "review", slug: "a", locale: "en" })).toBe("/reviews/a");
  });

  it("builds web and go-link URLs", () => {
    expect(webArticleUrl("https://ai-review.dev/", { type: "best_of", slug: "crm", locale: "de" })).toBe(
      "https://ai-review.dev/de/best/crm",
    );
    expect(goLinkUrl("https://ai-review.dev/go", "notion", "notion-review")).toBe(
      "https://ai-review.dev/go/notion?p=app&a=notion-review",
    );
  });
});

describe("API client", () => {
  it("adds locale to reads, the device token to /me calls, and maps errors", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("/me/saved")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (url.includes("/reviews/missing")) {
        return new Response(JSON.stringify({ error: { code: "not_found", message: "Review not found" } }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ data: [], pagination: { limit: 5, offset: 0, total: 0 }, init }), {
        status: 200,
      });
    });
    const api = createMobileApi({
      baseUrl: "https://api.example/",
      locale: "de",
      getToken: async () => "dev.secret",
      fetch: fetchFn as unknown as typeof fetch,
    });
    await api.listReviews({ limit: 5, category: undefined });
    expect(fetchFn.mock.calls[0]![0]).toBe("https://api.example/v1/reviews?limit=5&locale=de");
    await api.listSaved();
    const [, init] = fetchFn.mock.calls[1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer dev.secret");
    await expect(api.getReview("missing")).rejects.toMatchObject({ status: 404, code: "not_found" });

    const anon = createMobileApi({
      baseUrl: "https://api.example",
      locale: "en",
      fetch: fetchFn as unknown as typeof fetch,
    });
    await expect(anon.listAlerts()).rejects.toBeInstanceOf(ApiError);
    await anon.search("crm");
    expect(fetchFn.mock.calls.at(-1)![0]).toBe("https://api.example/v1/search?q=crm");
  });
});
