import { createLlm, type AnthropicLike, type CostHandler } from "@repo/ai";
import { findOrCreateProduct, listNotifications, listSuggestions } from "@repo/core";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  affiliateValue,
  collectHackerNews,
  dedupeCandidates,
  describeHomepage,
  evaluateCandidateUrl,
  expectedValue,
  parseAffiliateTerms,
  parseProductHuntFeed,
  probeAffiliate,
  programLinks,
  resolveRedirect,
  runProductSourcing,
  splitLaunchTitle,
  toWebsite,
  UNPROBED,
  type SourcingCandidate,
  type SourcingServices,
} from "./index";

const NOW = new Date("2026-10-10T12:00:00Z");

/** Routes fake HTTP by URL prefix; unknown URLs 404. Records every requested URL. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.startsWith(k));
    return key ? routes[key]!() : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}
const html = (body: string) => () => new Response(body, { headers: { "content-type": "text/html" } });
const json = (value: unknown) => () => Response.json(value);

/** Fake Anthropic returning a fixed structured-output JSON. */
function fakeLlm(data: unknown) {
  const client: AnthropicLike = {
    beta: {
      messages: {
        stream: () => ({
          finalMessage: async () =>
            ({
              model: "claude-haiku-5-5",
              stop_reason: "end_turn",
              stop_details: null,
              content: [{ type: "text", text: JSON.stringify(data) }],
              usage: {
                input_tokens: 500,
                output_tokens: 100,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
                iterations: null,
              },
            }) as never,
        }),
      },
    },
  };
  return (onCost: CostHandler) => createLlm({ client, onCost });
}

const candidate = (over: Partial<SourcingCandidate> = {}): SourcingCandidate => ({
  name: "Acme",
  url: "https://acme.io",
  domain: "acme.io",
  description: "AI notes",
  source: "hackernews",
  launch: {
    url: null,
    title: "Acme",
    votes: null,
    points: 100,
    comments: 3,
    publishedAt: NOW.toISOString(),
    topics: [],
  },
  ...over,
});

describe("sourcing helpers (FR-INT-7)", () => {
  it("splits launch titles and normalises websites", () => {
    expect(splitLaunchTitle("Show HN: Carrier-Explode: iPhone carrier settings decoded")).toEqual({
      name: "Carrier-Explode",
      description: "iPhone carrier settings decoded",
    });
    expect(splitLaunchTitle("Launch HN: Foo (YC W25) – AI for invoices")).toEqual({
      name: "Foo",
      description: "AI for invoices",
    });
    expect(splitLaunchTitle("Show HN: Bar")).toEqual({ name: "Bar", description: null });
    expect(toWebsite("https://app.acme.io/signup")).toEqual({ url: "https://app.acme.io", domain: "acme.io" });
    expect(toWebsite("https://github.com/acme/acme")).toBeNull();
    expect(toWebsite("https://acme.vercel.app")).toBeNull();
    expect(toWebsite("not a url")).toBeNull();
  });

  it("parses the Product Hunt Atom feed", () => {
    const xml = `<feed><entry><published>2026-10-09T00:16:56-07:00</published>
      <link rel="alternate" type="text/html" href="https://www.producthunt.com/products/tapnoise"/>
      <title>TapNoise</title><content type="html">&lt;p&gt; A tiny desktop pet &amp;amp; more &lt;/p&gt;
      &lt;p&gt;&lt;a href="https://www.producthunt.com/r/p/1274592?app_id=339"&gt;Link&lt;/a&gt;&lt;/p&gt;</content></entry></feed>`;
    expect(parseProductHuntFeed(xml)).toEqual([
      {
        name: "TapNoise",
        tagline: "A tiny desktop pet & more",
        postUrl: "https://www.producthunt.com/products/tapnoise",
        redirectUrl: "https://www.producthunt.com/r/p/1274592?app_id=339",
        publishedAt: "2026-10-09T00:16:56-07:00",
      },
    ]);
  });

  it("follows Product Hunt redirects to the product site", async () => {
    const { impl } = fakeFetch({
      "https://www.producthunt.com/r/p/1": () =>
        new Response(null, { status: 302, headers: { location: "https://www.producthunt.com/r/x" } }),
      "https://www.producthunt.com/r/x": () =>
        new Response(null, { status: 301, headers: { location: "https://acme.io/?ref=producthunt" } }),
      "https://www.producthunt.com/r/blocked": () => new Response("challenge", { status: 403 }),
    });
    expect(await resolveRedirect("https://www.producthunt.com/r/p/1", impl)).toBe("https://acme.io/?ref=producthunt");
    expect(await resolveRedirect("https://www.producthunt.com/r/blocked", impl)).toBeNull();
  });

  it("extracts affiliate terms conservatively", () => {
    expect(
      parseAffiliateTerms("Join our affiliate program. Earn 30% recurring commission for 12 months. 60-day cookie."),
    ).toMatchObject({
      commissionPercent: 30,
      recurring: true,
      cookieDays: 60,
    });
    expect(parseAffiliateTerms("Partners get a 20% one-time commission; cookie lasts 30 days")).toMatchObject({
      commissionPercent: 20,
      recurring: false,
      cookieDays: 30,
    });
    expect(parseAffiliateTerms("Save 20% on annual plans")).toMatchObject({
      commissionPercent: null,
      cookieDays: null,
    });
    expect(
      programLinks(
        '<a href="/affiliates">Affiliates</a><a href="/blog">Blog</a><a href="https://acme.partnerstack.com/">Partners</a><a href="https://x.com/acme">X</a>',
        "https://acme.io/",
      ),
    ).toEqual(["https://acme.io/affiliates", "https://acme.partnerstack.com/"]);
  });

  it("scores recurring programs and traction above unknowns", () => {
    expect(affiliateValue(UNPROBED)).toBe(0.25);
    expect(affiliateValue({ ...UNPROBED, probed: true })).toBe(0.1);
    const strong = {
      ...UNPROBED,
      probed: true,
      found: true,
      recurring: true,
      commissionPercent: 30,
      cookieDays: 90,
      network: "rewardful",
    };
    expect(affiliateValue(strong)).toBe(4);
    const a = expectedValue(candidate(), strong, 0.9, NOW);
    const b = expectedValue(candidate(), UNPROBED, 0.9, NOW);
    const offTopic = expectedValue(candidate(), strong, 0, NOW);
    expect(a.score).toBeGreaterThan(b.score);
    expect(offTopic.score).toBe(0);
    const old = expectedValue(
      candidate({ launch: { ...candidate().launch, publishedAt: "2026-07-01T00:00:00Z" } }),
      strong,
      0.9,
      NOW,
    );
    expect(old.components.freshness).toBe(0.5);
    expect(
      dedupeCandidates([candidate(), candidate({ name: "Acme PH", launch: { ...candidate().launch, points: 500 } })]),
    ).toEqual([candidate({ name: "Acme PH", launch: { ...candidate().launch, points: 500 } })]);
  });

  it("reads names from homepages", () => {
    expect(
      describeHomepage(
        '<title>Acme | AI notes</title><meta name="description" content="Notes that write themselves">',
        "acme.io",
      ),
    ).toEqual({ name: "Acme", description: "Notes that write themselves" });
    expect(describeHomepage('<meta property="og:site_name" content="Acme Inc">', "acme.io").name).toBe("Acme Inc");
  });

  it("probes affiliate pages, respecting robots.txt", async () => {
    const { impl, calls } = fakeFetch({
      "https://acme.io/robots.txt": () => new Response("User-agent: *\nDisallow: /partners"),
      "https://acme.io/": html(
        '<a href="/partners">Partners</a><a href="/affiliates">Affiliates</a><script src="https://r.wdfl.co/rw.js"></script>',
      ),
      "https://acme.io/affiliates": html(
        "<h1>Affiliate program</h1><p>Earn 25% lifetime commission. 45 day cookie.</p>",
      ),
    });
    const signal = await probeAffiliate("https://acme.io", { fetch: impl });
    expect(signal).toMatchObject({
      probed: true,
      found: true,
      url: "https://acme.io/affiliates",
      recurring: true,
      commissionPercent: 25,
      cookieDays: 45,
      network: "rewardful",
    });
    expect(calls).not.toContain("https://acme.io/partners");
  });
});

describe("sourcing run (FR-INT-7)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await ctx.reset();
    await seed(ctx.db);
  });

  const hits = {
    hits: [
      {
        objectID: "1",
        title: "Show HN: Acme – AI meeting notes",
        url: "https://acme.io",
        points: 300,
        num_comments: 40,
        created_at: "2026-10-09T10:00:00Z",
      },
      {
        objectID: "2",
        title: "Show HN: Bolt – Deploy previews",
        url: "https://www.bolt.dev/",
        points: 50,
        num_comments: 4,
        created_at: "2026-10-08T10:00:00Z",
      },
      {
        objectID: "3",
        title: "Show HN: My dotfiles",
        url: "https://github.com/me/dotfiles",
        points: 90,
        num_comments: 1,
        created_at: "2026-10-08T10:00:00Z",
      },
      {
        objectID: "4",
        title: "Show HN: Retro game",
        url: "https://game.example.org",
        points: 80,
        num_comments: 1,
        created_at: "2026-10-08T10:00:00Z",
      },
      {
        objectID: "5",
        title: "Show HN: Notion clone",
        url: "https://www.notion.so",
        points: 80,
        num_comments: 1,
        created_at: "2026-10-08T10:00:00Z",
      },
    ],
  };
  const routes = {
    "https://hn.algolia.com/api/v1/search_by_date?tags=show_hn": json(hits),
    "https://hn.algolia.com/api/v1/search_by_date?tags=story": json({ hits: [] }),
    "https://acme.io/": html('<a href="/affiliates">Affiliates</a>'),
    "https://acme.io/affiliates": html("<p>Affiliate program: earn 30% recurring commission, 60-day cookie</p>"),
    "https://www.bolt.dev/": html("<p>Deploy previews</p>"),
  };
  const llm = fakeLlm({
    items: [
      { id: "acme.io", categorySlug: "productivity", confidence: 0.9, reason: "Meeting notes SaaS" },
      { id: "bolt.dev", categorySlug: "developer-tools", confidence: 0.8, reason: "Deploy previews" },
      { id: "example.org", categorySlug: "none", confidence: 0.9, reason: "A game" },
    ],
  });
  const policy = { enabled: true, sources: ["hackernews", "networks"] as const, maxPerRun: 10, minScore: 0.5 };

  it("collects, classifies, probes, scores and queues new products", async () => {
    await findOrCreateProduct(ctx.db, { name: "Notion", websiteUrl: "https://www.notion.so" });
    const services: SourcingServices = { db: ctx.db, makeLlm: llm, fetch: fakeFetch(routes).impl };
    const summary = await runProductSourcing(services, {
      now: NOW,
      policy: { ...policy, sources: [...policy.sources] },
    });
    expect(summary).toMatchObject({ collected: 4, newCandidates: 3, onTopic: 2, created: 2, skipped: false });

    const queue = await listSuggestions(ctx.db, { status: "new" });
    expect(queue.map((s) => s.domain)).toEqual(["acme.io", "bolt.dev"]);
    expect(queue[0]).toMatchObject({ source: "hackernews", categorySlug: "productivity" });
    expect(queue[0]!.signals).toMatchObject({
      affiliate: { found: true, recurring: true, commissionPercent: 30, cookieDays: 60 },
      launch: { url: "https://news.ycombinator.com/item?id=1", points: 300 },
    });
    const [note] = await listNotifications(ctx.db);
    expect(note).toMatchObject({
      event: "sourcing.suggestions",
      title: "2 new suggested products",
      href: "/suggestions",
    });

    // A second run queues nothing new: queued domains are known; the off-topic one is re-screened.
    const again = await runProductSourcing(services, { now: NOW, policy: { ...policy, sources: [...policy.sources] } });
    expect(again).toMatchObject({ newCandidates: 1, onTopic: 0, created: 0 });
  });

  it("skips when disabled unless forced, and keeps collector errors", async () => {
    const services: SourcingServices = { db: ctx.db, makeLlm: llm, fetch: fakeFetch({}).impl };
    const off = { ...policy, enabled: false, sources: [...policy.sources] };
    expect(await runProductSourcing(services, { now: NOW, policy: off })).toMatchObject({ skipped: true });
    const forced = await runProductSourcing(services, { now: NOW, policy: off, force: true });
    expect(forced.skipped).toBe(false);
    expect(forced.errors.join(" ")).toMatch(/hackernews/);
  });

  it("evaluates a pasted website (manual add)", async () => {
    const services: SourcingServices = {
      db: ctx.db,
      makeLlm: llm,
      fetch: fakeFetch({
        ...routes,
        "https://acme.io/": html('<title>Acme — notes</title><a href="/affiliates">x</a>'),
      }).impl,
    };
    const res = await evaluateCandidateUrl(services, "acme.io", { now: NOW, productHuntToken: null });
    expect(res.created).toBe(true);
    expect(res.suggestion).toMatchObject({ name: "Acme", source: "manual", categorySlug: "productivity" });
    await expect(
      evaluateCandidateUrl(services, "https://www.producthunt.com/products/acme", { productHuntToken: null }),
    ).rejects.toThrow(/PRODUCT_HUNT_TOKEN/);
    await expect(evaluateCandidateUrl(services, "https://github.com/acme/acme")).rejects.toThrow(/own website/);
  });

  it("collects Hacker News launches with body links", async () => {
    const { impl } = fakeFetch({
      "https://hn.algolia.com/api/v1/search_by_date?tags=story": json({
        hits: [
          {
            objectID: "9",
            title: "Launch HN: Foo (YC W26) – Invoices on autopilot",
            url: null,
            story_text: "Try it at &lt;a href=&quot;https:&#x2F;&#x2F;foo.com&quot;&gt;foo.com&lt;/a&gt;",
            points: 40,
            num_comments: 10,
            created_at: "2026-10-09T10:00:00Z",
          },
        ],
      }),
    });
    const res = await collectHackerNews({ fetch: impl, now: NOW });
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({ name: "Foo", domain: "foo.com", launch: { topics: ["Launch HN"] } });
    expect(res.errors.join()).toMatch(/HTTP 404/);
  });
});
