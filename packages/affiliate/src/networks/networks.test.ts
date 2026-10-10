import { describe, expect, it } from "vitest";
import {
  configuredConversionNetworks,
  fetchAwinConversions,
  fetchImpactConversions,
  fetchNetworkConversions,
  fetchPartnerStackConversions,
  normalizeConversionStatus,
  parseMoney,
} from "./index";

const range = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-10T00:00:00Z") };

function mockFetch(pages: unknown[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  let i = 0;
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(pages[Math.min(i++, pages.length - 1)]), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("helpers", () => {
  it("normalises statuses and money", () => {
    expect(normalizeConversionStatus("APPROVED")).toBe("approved");
    expect(normalizeConversionStatus("declined")).toBe("reversed");
    expect(normalizeConversionStatus("Paid out")).toBe("paid");
    expect(normalizeConversionStatus(undefined)).toBe("pending");
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("1.234,50 €")).toBe(1234.5);
    expect(parseMoney(7)).toBe(7);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
  it("reports configured networks from env names", () => {
    expect(configuredConversionNetworks({ PARTNERSTACK_API_KEY: "x" })).toEqual(["partnerstack"]);
    expect(
      configuredConversionNetworks({ IMPACT_ACCOUNT_SID: "a", IMPACT_AUTH_TOKEN: "b", AWIN_API_TOKEN: "t" }),
    ).toEqual(["impact"]);
  });
});

describe("Impact", () => {
  it("maps actions and follows pagination", async () => {
    const { impl, calls } = mockFetch([
      {
        Actions: [
          {
            Id: "A1",
            CampaignName: "Notion",
            State: "APPROVED",
            Amount: "100.00",
            Payout: "20.00",
            Currency: "usd",
            EventDate: "2026-09-02T10:00:00-07:00",
            SubId1: "notion-review--hero",
          },
        ],
        "@nextpageuri": "/Mediapartners/SID/Actions?Page=2",
      },
      { Actions: [{ Id: "A2", State: "REVERSED", Payout: "5", EventDate: "2026-09-03T00:00:00Z" }, {}] },
    ]);
    const rows = await fetchImpactConversions(range, { accountSid: "SID", authToken: "TOK" }, impl);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      network: "impact",
      program: "Notion",
      subId: "notion-review--hero",
      orderId: "A1",
      amount: 100,
      commission: 20,
      currency: "USD",
      status: "approved",
    });
    expect(rows[1]).toMatchObject({ orderId: "A2", status: "reversed", subId: null, currency: "USD" });
    expect(calls[0]!.url).toContain("/Mediapartners/SID/Actions?ActionDateStart=2026-09-01T00%3A00%3A00Z");
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from("SID:TOK").toString("base64")}`);
    expect(calls[1]!.url).toBe("https://api.impact.com/Mediapartners/SID/Actions?Page=2");
  });
  it("throws on HTTP errors", async () => {
    const impl = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(fetchImpactConversions(range, { accountSid: "S", authToken: "T" }, impl)).rejects.toThrow(/401/);
  });
});

describe("PartnerStack", () => {
  it("maps rewards in cents and pages with starting_after", async () => {
    const { impl, calls } = mockFetch([
      {
        data: {
          has_more: true,
          items: [
            {
              key: "rew_1",
              amount: 1500,
              currency: "usd",
              status: "approved",
              created_at: Date.parse("2026-09-05T00:00:00Z"),
              company: { name: "Webflow" },
              transaction: { amount: 5000 },
              customer: { meta: { ps_xid: "webflow-review--pricing" } },
            },
          ],
        },
      },
      { data: { has_more: false, items: [{ key: "rew_2", amount: 100, status: "paid" }] } },
    ]);
    const rows = await fetchPartnerStackConversions(range, { apiKey: "k" }, impl);
    expect(rows[0]).toMatchObject({
      program: "Webflow",
      subId: "webflow-review--pricing",
      orderId: "rew_1",
      amount: 50,
      commission: 15,
      status: "approved",
    });
    expect(rows[1]).toMatchObject({ orderId: "rew_2", commission: 1, status: "paid", amount: null });
    expect(calls[1]!.url).toContain("starting_after=rew_1");
    expect(calls[0]!.headers.Authorization).toBe("Bearer k");
  });
});

describe("Awin", () => {
  it("maps transactions and splits the range into 30-day windows", async () => {
    const { impl, calls } = mockFetch([
      [
        {
          id: 99,
          advertiserId: 1234,
          commissionStatus: "approved",
          saleAmount: { amount: 80, currency: "EUR" },
          commissionAmount: { amount: 8, currency: "EUR" },
          transactionDate: "2026-09-10T12:00:00",
          clickRefs: { clickRef: "canva-review--final_cta" },
        },
        { id: 100, paidToPublisher: true, commissionAmount: { amount: 2 } },
      ],
      [],
    ]);
    const rows = await fetchAwinConversions(range, { apiToken: "t", publisherId: "55" }, impl);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("/publishers/55/transactions/?startDate=2026-09-01T00%3A00%3A00");
    expect(rows[0]).toMatchObject({
      program: "awin:1234",
      subId: "canva-review--final_cta",
      orderId: "99",
      amount: 80,
      commission: 8,
      currency: "EUR",
      status: "approved",
    });
    expect(rows[1]).toMatchObject({ orderId: "100", status: "paid", currency: "GBP", program: null });
  });
  it("dispatches by network name with env credentials", async () => {
    const { impl, calls } = mockFetch([[]]);
    await fetchNetworkConversions(
      "awin",
      { from: range.from, to: new Date("2026-09-02T00:00:00Z") },
      { AWIN_API_TOKEN: "t", AWIN_PUBLISHER_ID: "9" },
      impl,
    );
    expect(calls[0]!.url).toContain("/publishers/9/");
  });
});
