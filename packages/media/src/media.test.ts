import { mediaBlobs, eq } from "@repo/db";
import { setupTestDb } from "@repo/db/testing";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDbStorage,
  createR2Storage,
  mediaSrcSet,
  mediaUrl,
  processImage,
  saveImageAsset,
  urlForKey,
} from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 79, g: 70, b: 229 } } })
    .png()
    .toBuffer();

describe("processImage", () => {
  it("encodes WebP and only makes variants smaller than the original", async () => {
    const out = await processImage(await png(1000, 500));
    expect(out.original).toMatchObject({ mimeType: "image/webp", width: 1000, height: 500 });
    expect(Object.keys(out.variants).sort()).toEqual(["card", "thumb"]);
    expect(out.variants.card).toMatchObject({ width: 800, height: 400 });
  });
});

describe("saveImageAsset with the db driver", () => {
  it("stores original + variants and is idempotent for the same bytes", async () => {
    const storage = createDbStorage(ctx.db);
    const bytes = await png(1800, 900);
    const a = await saveImageAsset(ctx.db, storage, {
      bytes,
      kind: "graphic",
      origin: "templated",
      prefix: "test/og",
      role: "og",
    });
    expect(a.storage).toBe("db");
    expect(a.storageKey).toMatch(/^test\/og\/[0-9a-f]{24}\.webp$/);
    expect(Object.keys(a.variants).sort()).toEqual(["card", "full", "thumb"]);
    const blobs = await ctx.db.select({ key: mediaBlobs.key }).from(mediaBlobs);
    expect(blobs).toHaveLength(4);
    const b = await saveImageAsset(ctx.db, storage, { bytes, kind: "graphic", origin: "templated", prefix: "test/og" });
    expect(b.id).toBe(a.id);
    const [blob] = await ctx.db.select().from(mediaBlobs).where(eq(mediaBlobs.key, a.storageKey));
    expect(blob!.data.subarray(8, 12).toString()).toBe("WEBP");
  });
});

describe("R2 driver", () => {
  it("signs a PUT to the account endpoint with immutable caching", async () => {
    const seen: Request[] = [];
    const storage = createR2Storage(
      { accountId: "acc", accessKeyId: "AK", secretAccessKey: "SK", bucket: "media" },
      async (req) => {
        seen.push(req as Request);
        return new Response("", { status: 200 });
      },
    );
    await storage.put("products/p 1/a.webp", Buffer.from("x"), "image/webp");
    expect(seen[0]!.method).toBe("PUT");
    expect(seen[0]!.url).toBe("https://acc.r2.cloudflarestorage.com/media/products/p%201/a.webp");
    expect(seen[0]!.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
    expect(seen[0]!.headers.get("cache-control")).toContain("immutable");
  });
  it("surfaces upload errors", async () => {
    const storage = createR2Storage(
      { accountId: "a", accessKeyId: "b", secretAccessKey: "c", bucket: "d" },
      async () => new Response("denied", { status: 403 }),
    );
    await expect(storage.put("k", Buffer.from("x"), "image/webp")).rejects.toThrow(/403/);
  });
});

describe("urls", () => {
  const env = { mediaBaseUrl: "https://media.example/", siteUrl: "https://site.example" };
  it("serves R2 objects from the media domain and db objects from the site", () => {
    expect(urlForKey("r2", "a/b c.webp", env)).toBe("https://media.example/a/b%20c.webp");
    expect(urlForKey("db", "a/b.webp", env)).toBe("https://site.example/media/a/b.webp");
    expect(urlForKey("r2", "a.webp", { siteUrl: "https://site.example" })).toBe("https://site.example/media/a.webp");
  });
  it("picks variants and builds srcset", () => {
    const ref = {
      storage: "r2" as const,
      storageKey: "k.webp",
      variants: {
        card: { key: "k-card.webp", width: 800, height: 400, mime: "image/webp" },
        thumb: { key: "k-thumb.webp", width: 320, height: 160, mime: "image/webp" },
      },
    };
    expect(mediaUrl(ref, "card", env)).toBe("https://media.example/k-card.webp");
    expect(mediaUrl(ref, "full", env)).toBe("https://media.example/k.webp");
    expect(mediaSrcSet(ref, env)).toBe(
      "https://media.example/k-thumb.webp 320w, https://media.example/k-card.webp 800w",
    );
  });
});
