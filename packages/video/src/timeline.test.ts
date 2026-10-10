import { describe, expect, it } from "vitest";
import { qrPath } from "./qr";
import { thumbnailFrames } from "./render";
import { buildTimeline, captionLines, countWords, estimateSeconds, youTubeChapters } from "./timeline";
import { DEFAULT_THEME, type VideoInputProps } from "./types";

const scene = (id: string, narration: string, visual: "title" | "score" | "outro" = "title") => ({
  id,
  visual,
  narration,
  onScreenText: id,
  imageUrl: null,
});

describe("timeline", () => {
  it("counts words and estimates speaking time at 150 wpm", () => {
    expect(countWords("  one two\nthree ")).toBe(3);
    expect(estimateSeconds("word ".repeat(150))).toBe(60);
  });

  it("splits scenes on word timings and holds a tail after the audio", () => {
    const words = ["a", "b", "c", "d", "e"].map((w, i) => ({ word: w, startMs: i * 1000, endMs: i * 1000 + 800 }));
    const t = buildTimeline([scene("s1", "a b"), scene("s2", "c d e")], words, { fps: 30, tailMs: 1000 });
    expect(t.scenes.map((s) => [s.startFrame, s.durationFrames])).toEqual([
      [0, 60],
      [60, 114],
    ]);
    expect(t.durationInFrames).toBe(174);
  });

  it("estimates durations without audio and never overlaps scenes", () => {
    const t = buildTimeline([scene("s1", "one two three"), scene("s2", "x")], [], { fps: 30, tailMs: 0 });
    expect(t.scenes[0]!.startFrame).toBe(0);
    expect(t.scenes[1]!.startFrame).toBe(t.scenes[0]!.durationFrames);
    expect(t.durationInFrames).toBe(t.scenes[1]!.startFrame + t.scenes[1]!.durationFrames);
  });

  it("survives more script words than spoken words", () => {
    const words = [{ word: "a", startMs: 0, endMs: 500 }];
    const t = buildTimeline([scene("s1", "a"), scene("s2", "b c")], words, { fps: 30 });
    expect(t.scenes[1]!.durationFrames).toBeGreaterThan(0);
  });

  it("breaks captions at sentence ends and length", () => {
    const words = "One two. Three four five six seven".split(" ").map((w, i) => ({ word: w, startMs: i, endMs: i }));
    expect(captionLines(words, 3).map((l) => l.map((w) => w.word).join(" "))).toEqual([
      "One two.",
      "Three four five",
      "six seven",
    ]);
  });

  it("builds YouTube chapters only when there are three spaced ones", () => {
    const scenes = [0, 300, 330, 900].map((f, i) => ({ startFrame: f, onScreenText: `Part ${i}` }));
    expect(youTubeChapters(scenes, 30)).toEqual(["00:00 Part 0", "00:10 Part 1", "00:30 Part 3"]);
    expect(youTubeChapters(scenes.slice(0, 2), 30)).toEqual([]);
  });
});

describe("qrPath", () => {
  it("encodes a URL into a square module grid", () => {
    const qr = qrPath("https://ai-review.dev/reviews/example");
    expect(qr.size).toBeGreaterThanOrEqual(21);
    expect(qr.d.startsWith("M")).toBe(true);
  });
});

describe("thumbnailFrames", () => {
  it("picks settled frames from the title and score scenes", () => {
    const props = {
      theme: DEFAULT_THEME,
      durationInFrames: 300,
      scenes: [
        { id: "a", visual: "title", onScreenText: "", imageUrl: null, startFrame: 0, durationFrames: 100 },
        { id: "b", visual: "score", onScreenText: "", imageUrl: null, startFrame: 100, durationFrames: 20 },
      ],
    } as unknown as VideoInputProps;
    expect(thumbnailFrames(props, 3)).toEqual([45, 115]);
  });
});
