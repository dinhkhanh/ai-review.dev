import { setupTestDb } from "@repo/db/testing";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  annotationSvg,
  clampCrop,
  createDbStorage,
  escapeXml,
  parseAnnotations,
  processScreenshot,
  readAssetBytes,
  saveImageAsset,
  saveProcessedScreenshot,
} from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .png()
    .toBuffer();

describe("helpers", () => {
  it("clamps crops to the image and rejects empty ones", () => {
    expect(clampCrop({ x: -10, y: 5, width: 500, height: 50 }, 300, 200)).toEqual({
      x: 0,
      y: 5,
      width: 300,
      height: 50,
    });
    expect(clampCrop({ x: 299, y: 0, width: 50, height: 50 }, 300, 200)).toBeNull();
  });
  it("escapes label text in SVG", () => {
    expect(escapeXml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
    const svg = annotationSvg([{ type: "label", x: 1, y: 2, text: "<script>" }], 100, 100);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
  });
});

describe("parseAnnotations", () => {
  it("parses boxes, arrows and labels and reports bad lines", () => {
    const out = parseAnnotations(
      "box 1 2 3 4\narrow 10 20 -5 6\nlabel 7 8 Live visitor count\n\nbox 1 2\ncircle 1 1 1 1\nlabel 1 2",
    );
    expect(out.annotations).toEqual([
      { type: "box", x: 1, y: 2, w: 3, h: 4 },
      { type: "arrow", x: 10, y: 20, w: -5, h: 6 },
      { type: "label", x: 7, y: 8, text: "Live visitor count" },
    ]);
    expect(out.errors).toHaveLength(3);
  });
});

describe("processScreenshot", () => {
  it("crops, then frames in a browser window", async () => {
    const out = await processScreenshot(await png(1280, 800), {
      crop: { x: 0, y: 0, width: 1000, height: 600 },
      frame: "browser",
      host: "acme.dev",
      annotations: [
        { type: "box", x: 10, y: 10, w: 100, h: 50 },
        { type: "arrow", x: 200, y: 200, w: 50, h: 30 },
      ],
    });
    expect(out.mimeType).toBe("image/webp");
    expect(out.bytes.subarray(8, 12).toString()).toBe("WEBP");
    expect(out.width).toBeGreaterThan(1000);
    expect(out.height).toBeGreaterThan(600);
  });
  it("adds a phone bezel and downscales to maxWidth", async () => {
    const out = await processScreenshot(await png(390, 844), { frame: "phone", maxWidth: 300 });
    expect(out.width).toBe(300);
    expect(out.height).toBeGreaterThan(out.width);
  });
  it("leaves size unchanged without frame or crop", async () => {
    const out = await processScreenshot(await png(400, 300), {
      annotations: [{ type: "label", x: 5, y: 5, text: "Hi" }],
    });
    expect([out.width, out.height]).toEqual([400, 300]);
  });
});

describe("saveProcessedScreenshot", () => {
  it("reads the original from storage and stores a linked graphic", async () => {
    const storage = createDbStorage(ctx.db);
    const parent = await saveImageAsset(ctx.db, storage, {
      bytes: await png(1280, 800),
      kind: "screenshot",
      origin: "captured",
      prefix: "test/shots",
      role: "screenshot:home:desktop",
      alt: "Home page",
    });
    expect((await readAssetBytes(parent, storage)).subarray(8, 12).toString()).toBe("WEBP");
    const child = await saveProcessedScreenshot(ctx.db, storage, parent, { frame: "browser", host: "acme.dev" });
    expect(child).toMatchObject({
      parentAssetId: parent.id,
      kind: "graphic",
      origin: "templated",
      role: "screenshot:home:desktop:processed",
      alt: "Home page",
    });
    expect(await storage.get!("missing/key.webp")).toBeNull();
  });
  it("falls back to the public URL when storage cannot read", async () => {
    const bytes = await readAssetBytes(
      { storage: "r2", storageKey: "a/b.webp", variants: {} },
      null,
      (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch,
    );
    expect([...bytes]).toEqual([1, 2, 3]);
  });
});
