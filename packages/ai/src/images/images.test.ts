import { describe, expect, it } from "vitest";
import type { CostEvent } from "../cost-event";
import {
  buildIllustrationPrompt,
  createFalImageGenerator,
  falCostUsd,
  ImageGenerationError,
  stripNames,
} from "./index";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fal image generator", () => {
  it("returns null without a key", () => {
    expect(createFalImageGenerator({ apiKey: "" })).toBeNull();
  });

  it("posts the prompt and records the cost", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const costs: CostEvent[] = [];
    const gen = createFalImageGenerator({
      apiKey: "k",
      onCost: (e) => void costs.push(e),
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return json({
          images: [{ url: "https://fal.media/x.jpg", width: 1024, height: 576, content_type: "image/jpeg" }],
          seed: 7,
        });
      }) as unknown as typeof fetch,
    })!;
    const img = await gen.generate({ prompt: "abstract shapes" });
    expect(calls[0]!.url).toBe("https://fal.run/fal-ai/flux/schnell");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Key k");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      prompt: "abstract shapes",
      image_size: "landscape_16_9",
    });
    expect(img).toMatchObject({ url: "https://fal.media/x.jpg", seed: 7, model: "fal-ai/flux/schnell" });
    expect(costs[0]).toMatchObject({ provider: "fal", unitType: "images", units: 1, costUsd: 0.003 });
  });

  it("raises typed errors for HTTP failures, empty results and safety rejections", async () => {
    const make = (res: Response) =>
      createFalImageGenerator({ apiKey: "k", fetchImpl: (async () => res) as unknown as typeof fetch })!;
    await expect(make(json({ detail: "bad" }, 422)).generate({ prompt: "p" })).rejects.toMatchObject({ status: 422 });
    await expect(make(json({ images: [] })).generate({ prompt: "p" })).rejects.toMatchObject({ reason: "empty" });
    await expect(
      make(json({ images: [{ url: "u" }], has_nsfw_concepts: [true] })).generate({ prompt: "p" }),
    ).rejects.toBeInstanceOf(ImageGenerationError);
  });

  it("bills per started megapixel", () => {
    expect(falCostUsd("fal-ai/flux/schnell", 1024, 576)).toBe(0.003);
    expect(falCostUsd("fal-ai/flux/dev", 1920, 1080)).toBeCloseTo(0.075);
  });
});

describe("buildIllustrationPrompt", () => {
  it("uses the category theme, strips product names and keeps the guardrails", () => {
    const prompt = buildIllustrationPrompt({
      categorySlug: "marketing",
      themes: ["Teams leaving Mailchimp", "solo founders"],
      avoidNames: ["Mailchimp", "Acme"],
    });
    expect(prompt).toContain("funnels");
    expect(prompt).not.toMatch(/mailchimp|acme/i);
    expect(prompt).toContain("no logos");
    expect(prompt).toContain("no text");
  });
  it("falls back to the category name or a generic theme", () => {
    expect(buildIllustrationPrompt({ categoryName: "CRM" })).toContain("CRM software");
    expect(buildIllustrationPrompt({})).toContain("abstract software");
  });
  it("strips names case-insensitively, including regex characters", () => {
    expect(stripNames("Best for C++ fans of Notion", ["c++", "notion"])).toBe("Best for fans of");
  });
});
