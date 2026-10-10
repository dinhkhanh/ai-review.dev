import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSearchConsoleClient,
  normalizePrivateKey,
  searchConsoleCredentialsFromEnv,
  serviceAccountAssertion,
} from "./index";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("search console credentials", () => {
  it("needs all three env values and unescapes the key", () => {
    expect(searchConsoleCredentialsFromEnv({ GSC_CLIENT_EMAIL: "a@b" })).toBeNull();
    const creds = searchConsoleCredentialsFromEnv({
      GSC_CLIENT_EMAIL: "sa@proj.iam.gserviceaccount.com",
      GSC_PRIVATE_KEY: `"${pem.replace(/\n/g, "\\n")}"`,
      GSC_SITE_URL: "sc-domain:ai-review.dev",
    });
    expect(creds?.privateKey).toBe(pem.trim());
    expect(normalizePrivateKey("'x\\ny'")).toBe("x\ny");
  });

  it("signs a verifiable RS256 assertion with the read-only scope", () => {
    const jwt = serviceAccountAssertion({ clientEmail: "sa@x", privateKey: pem }, new Date("2026-10-11T00:00:00Z"));
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
    expect(claims).toMatchObject({
      iss: "sa@x",
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
    });
    expect(claims.exp - claims.iat).toBe(3600);
    const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("createSearchConsoleClient", () => {
  it("returns null without credentials", () => {
    expect(createSearchConsoleClient(null)).toBeNull();
  });

  it("exchanges a token once and pages with startRow until a short page", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    let page = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      page++;
      const n = page === 1 ? 25_000 : 3;
      const rows = Array.from({ length: n }, (_, i) => ({
        keys: ["2026-10-01", `/reviews/p${i}`],
        clicks: 1,
        impressions: 10,
        ctr: 0.1,
        position: 4.2,
      }));
      return new Response(JSON.stringify({ rows }));
    }) as unknown as typeof fetch;
    const client = createSearchConsoleClient(
      { clientEmail: "sa@x", privateKey: pem, siteUrl: "sc-domain:ai-review.dev" },
      fetchImpl,
    )!;
    const rows = await client.query({ startDate: "2026-10-01", endDate: "2026-10-05", dimensions: ["date", "page"] });
    expect(rows).toHaveLength(25_003);
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    const queries = calls.filter((c) => !c.url.includes("oauth2"));
    expect(queries[0]!.url).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aai-review.dev/searchAnalytics/query",
    );
    expect(JSON.parse(queries[0]!.body)).toMatchObject({ startRow: 0, rowLimit: 25_000, type: "web" });
    expect(JSON.parse(queries[1]!.body)).toMatchObject({ startRow: 25_000 });
  });

  it("respects maxRows and surfaces API errors", async () => {
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok" }));
      const { rowLimit } = JSON.parse(String(init.body));
      if (rowLimit === 7) return new Response(JSON.stringify({ rows: [] }));
      return new Response("forbidden", { status: 403 });
    }) as unknown as typeof fetch;
    const client = createSearchConsoleClient({ clientEmail: "a", privateKey: pem, siteUrl: "s" }, fetchImpl)!;
    await expect(client.query({ startDate: "a", endDate: "b", dimensions: ["page"], maxRows: 7 })).resolves.toEqual([]);
    await expect(client.query({ startDate: "a", endDate: "b", dimensions: ["page"] })).rejects.toThrow(/403/);
  });
});
