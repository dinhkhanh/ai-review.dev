import type { Llm, Tts, YouTubeUploadInput } from "@repo/ai";
import type { ArticleBody } from "@repo/content";
import {
  addArticleVersion,
  createArticle,
  createProduct,
  getVideo,
  listNotifications,
  publicVideo,
  publishedVideosForArticle,
} from "@repo/core";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { createDbStorage, saveImageAsset } from "@repo/media";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StepServices } from "../step";
import { runVideo, type VideoRenderer } from "./run";
import { narrationWords, wordRange, type VideoScriptDraft } from "./script";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
});

const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

function draft(perScene: number): VideoScriptDraft {
  return {
    title: "Acme review: a fast tracker for small teams",
    description: "We tested Acme. It is quick and fairly priced.",
    tags: ["acme review", "project tracker"],
    scenes: [
      { visual: "title", narration: words(perScene), onScreenText: "Acme review", imageRef: "" },
      { visual: "screenshot", narration: words(perScene), onScreenText: "The dashboard", imageRef: "IMG1" },
      { visual: "screenshot", narration: words(perScene), onScreenText: "Unknown image", imageRef: "IMG9" },
      { visual: "pricing", narration: words(perScene), onScreenText: "Pricing", imageRef: "" },
      { visual: "verdict", narration: words(perScene), onScreenText: "Our verdict", imageRef: "" },
      { visual: "outro", narration: words(perScene), onScreenText: "Full review", imageRef: "" },
    ],
  };
}

async function fixture() {
  const product = await createProduct(ctx.db, { name: "Acme", websiteUrl: "https://acme.dev" });
  const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: "#4f46e5" } })
    .png()
    .toBuffer();
  const storage = createDbStorage(ctx.db);
  const shot = await saveImageAsset(ctx.db, storage, {
    bytes: png,
    kind: "screenshot",
    origin: "captured",
    prefix: `products/${product.id}/screenshots`,
    role: "screenshot:home:desktop",
    alt: "Acme dashboard",
    productId: product.id,
  });
  const article = await createArticle(ctx.db, {
    type: "review",
    productId: product.id,
    title: "Acme review",
    slug: "acme",
  });
  const blocks: ArticleBody = [
    { id: "verdict", type: "verdict", score: 8.1, summary: "Fast and fair.", bestFor: ["Small teams"], notFor: [] },
    { id: "intro-0", type: "paragraph", children: [{ text: "Acme is a project tracker.", marks: [] }] },
    {
      id: "pricing-table",
      type: "pricing_table",
      verifiedAt: new Date().toISOString(),
      tiers: [{ name: "Plus", price: 12, currency: "USD", period: "month", highlights: [], citations: [] }],
    },
    { id: "pros-cons", type: "pros_cons", pros: ["Fast"], cons: ["No time tracking"] },
    { id: "shot-home", type: "image", assetId: shot.id },
  ];
  await addArticleVersion(ctx.db, article.id, { blocks, overallScore: 8.1 });
  return { product, article, shot, storage };
}

function fakeLlm(responses: VideoScriptDraft[]): { llm: Llm; prompts: string[] } {
  const prompts: string[] = [];
  const llm = {
    async generateStructured(opts: { prompt: string }) {
      prompts.push(opts.prompt);
      return { data: responses.shift()!, model: "fake", text: "", stopReason: "end_turn", fallbackUsed: false };
    },
  } as unknown as Llm;
  return { llm, prompts };
}

const fakeTts: Tts = {
  provider: "fake",
  async synthesize(text) {
    const list = text.split(" ").map((word, i) => ({ word, startMs: i * 300, endMs: i * 300 + 250 }));
    return {
      audio: Buffer.from("ID3fake-mp3"),
      mimeType: "audio/mpeg",
      words: list,
      durationMs: list.length * 300,
      voiceId: "voice-1",
      characters: text.length,
    };
  },
};

describe("runVideo", () => {
  it("runs script → voice → render → upload and stores every artefact", async () => {
    const { article, shot, storage } = await fixture();
    const { llm, prompts } = fakeLlm([draft(5), draft(35)]);
    const uploads: YouTubeUploadInput[] = [];
    const seenImages: number[] = [];
    const renderer: VideoRenderer = {
      async render(props) {
        // Images reach the renderer through the loopback asset server.
        const shotScene = props.scenes.find((s) => s.imageUrl);
        const res = await fetch(shotScene!.imageUrl!);
        seenImages.push(res.status);
        expect(props.scenes).toHaveLength(6);
        expect(props.scenes[2]!.visual).toBe("verdict"); // unknown image ref falls back
        expect(props.pricing[0]).toMatchObject({ name: "Plus", price: 12 });
        expect(props.audioUrl).toMatch(/^http:\/\/127\.0\.0\.1/);
        expect(props.goUrl).toBe("https://ai-review.dev/reviews/acme");
        return { mp4: Buffer.from("fake-mp4"), thumbnails: [Buffer.from("fake-jpg")] };
      },
    };
    const services = { db: ctx.db, makeLlm: () => llm, makeFirecrawl: () => null, storage } as unknown as StepServices;
    const video = await runVideo(
      services,
      { articleId: article.id, kind: "short", stage: "all" },
      {
        tts: fakeTts,
        renderer,
        siteUrl: "https://ai-review.dev",
        youtube: {
          async upload(input) {
            uploads.push(input);
            return { videoId: "yt-1", thumbnailSet: true };
          },
        },
      },
    );

    // The first draft was too short (30 words) and got a retry with feedback.
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("must be 150–300 words");
    expect(narrationWords(video.script!)).toBe(210);
    expect(video.script!.scenes[1]!.assetId).toBe(shot.id);
    expect(seenImages).toEqual([200]);
    expect(video).toMatchObject({ status: "published", youtubeId: "yt-1", voiceId: "voice-1" });
    expect(video.videoAssetId && video.audioAssetId && video.thumbnailAssetId).toBeTruthy();
    expect(video.captions).toHaveLength(210);
    expect(uploads[0]!.privacyStatus).toBe("private");
    expect(uploads[0]!.description).toContain("Full review: https://ai-review.dev/reviews/acme");
    expect(uploads[0]!.description).toContain("affiliate links");
    expect(uploads[0]!.thumbnail?.bytes.toString()).toBe("fake-jpg");
    expect((await listNotifications(ctx.db)).map((n) => n.event)).toContain("video.ready");

    const live = await publishedVideosForArticle(ctx.db, article.id);
    expect(live.map(publicVideo)[0]).toMatchObject({ kind: "short", youtubeId: "yt-1" });

    // Re-voicing clears the render but keeps the live YouTube id until a new upload.
    const revoiced = await runVideo(
      services,
      { articleId: article.id, kind: "short", stage: "voice" },
      { tts: fakeTts },
    );
    expect(revoiced).toMatchObject({ status: "draft", videoAssetId: null, youtubeId: "yt-1" });
  });

  it("marks the video failed and notifies when a stage cannot run", async () => {
    const { article, storage } = await fixture();
    const services = {
      db: ctx.db,
      makeLlm: () => fakeLlm([]).llm,
      makeFirecrawl: () => null,
      storage,
    } as unknown as StepServices;
    await expect(
      runVideo(services, { articleId: article.id, kind: "long", stage: "render" }, { renderer: {} as VideoRenderer }),
    ).rejects.toThrow(/No script yet/);
    expect(await getVideo(ctx.db, article.id, "long")).toMatchObject({ status: "failed" });
    expect((await listNotifications(ctx.db)).map((n) => n.event)).toContain("video.failed");
  });
});

describe("wordRange", () => {
  it("maps duration targets to narration words at 150 wpm", () => {
    expect(wordRange("short")).toEqual({ min: 150, max: 300 });
    expect(wordRange("long")).toEqual({ min: 600, max: 1200 });
  });
});
