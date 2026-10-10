import { describe, expect, it } from "vitest";
import { createElevenLabsTts, splitForTts, wordsFromAlignment, type Alignment } from "./index";

function alignmentFor(text: string, startS = 0): Alignment {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => startS + i * 0.05),
    character_end_times_seconds: chars.map((_, i) => startS + (i + 1) * 0.05),
  };
}

describe("wordsFromAlignment", () => {
  it("groups characters into words with ms timings and an offset", () => {
    const words = wordsFromAlignment(alignmentFor("Hi there"), 1000);
    expect(words).toEqual([
      { word: "Hi", startMs: 1000, endMs: 1100 },
      { word: "there", startMs: 1150, endMs: 1400 },
    ]);
  });
});

describe("splitForTts", () => {
  it("keeps short text whole and splits long text at sentences", () => {
    expect(splitForTts("  One.  Two. ", 100)).toEqual(["One. Two."]);
    const chunks = splitForTts("First sentence here. Second sentence here. Third one.", 25);
    expect(chunks).toEqual(["First sentence here.", "Second sentence here.", "Third one."]);
    expect(splitForTts("averyveryverylongword another word", 12).every((c) => c.length <= 21)).toBe(true);
  });
});

describe("createElevenLabsTts", () => {
  it("returns null without a key", () => {
    expect(createElevenLabsTts({ apiKey: "" })).toBeNull();
  });

  it("synthesises chunks, offsets word timings by audio length and reports cost", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    // 16 000 bytes of 128 kbps CBR audio = 1 000 ms.
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      return new Response(
        JSON.stringify({ audio_base64: Buffer.alloc(16_000).toString("base64"), alignment: alignmentFor(body.text) }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const costs: number[] = [];
    const tts = createElevenLabsTts({
      apiKey: "k",
      fetchImpl,
      maxCharsPerRequest: 12,
      onCost: (e) => {
        costs.push(e.units);
      },
    })!;
    const res = await tts.synthesize("Hello world. Bye now.", { voiceId: "v1" });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("/v1/text-to-speech/v1/with-timestamps");
    expect(calls[0]!.body.next_text).toBe("Bye now.");
    expect(calls[1]!.body.previous_text).toBe("Hello world.");
    expect(res.durationMs).toBe(2000);
    expect(res.words.map((w) => w.word)).toEqual(["Hello", "world.", "Bye", "now."]);
    expect(res.words[2]!.startMs).toBe(1000);
    expect(res.audio.length).toBe(32_000);
    expect(costs).toEqual([12, 8]);
  });

  it("throws on HTTP errors", async () => {
    const tts = createElevenLabsTts({
      apiKey: "k",
      fetchImpl: (async () => new Response("quota", { status: 401 })) as unknown as typeof fetch,
    })!;
    await expect(tts.synthesize("Hi")).rejects.toThrow(/HTTP 401/);
  });
});
