import type { CaptionWord, TimedScene } from "./types";
import type { SceneVisual } from "./visuals";

/** Speaking rate used to plan and validate scripts (FR-VID-1). */
export const WORDS_PER_MINUTE = 150;

/** Narration length targets per kind (FR-VID-1): short 60–120 s, long 4–8 min. */
export const DURATION_TARGETS = {
  short: { minSeconds: 60, maxSeconds: 120 },
  long: { minSeconds: 240, maxSeconds: 480 },
} as const;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function estimateSeconds(text: string, wpm = WORDS_PER_MINUTE): number {
  return (countWords(text) / wpm) * 60;
}

export interface SceneInput {
  id: string;
  visual: SceneVisual;
  narration: string;
  onScreenText: string;
  imageUrl: string | null;
}

/**
 * Places scenes on the audio timeline. TTS speaks the narrations joined with spaces, so the
 * word timings split back into scenes by word count: a scene starts at its first word and ends
 * where the next scene's first word starts. The last scene holds `tailMs` after the audio ends.
 * Without word timings (no TTS yet) durations are estimated at 150 wpm.
 */
export function buildTimeline(
  scenes: SceneInput[],
  words: CaptionWord[],
  opts: { fps: number; tailMs?: number; audioMs?: number | null; minSceneMs?: number },
): { scenes: TimedScene[]; durationInFrames: number } {
  const tail = opts.tailMs ?? 1500;
  const minScene = opts.minSceneMs ?? 1200;
  const frameAt = (ms: number) => Math.round((ms / 1000) * opts.fps);

  const startsMs: number[] = [];
  let endMs: number;
  if (words.length > 0) {
    const lastEnd = words[words.length - 1]!.endMs;
    let index = 0;
    for (const scene of scenes) {
      startsMs.push(startsMs.length === 0 ? 0 : index < words.length ? words[index]!.startMs : lastEnd);
      index += countWords(scene.narration);
    }
    endMs = Math.max(opts.audioMs ?? 0, lastEnd) + tail;
  } else {
    let t = 0;
    for (const scene of scenes) {
      startsMs.push(t);
      t += Math.max(minScene, estimateSeconds(scene.narration) * 1000);
    }
    endMs = t + tail;
  }

  // Scenes never overlap and never get shorter than half the minimum (a word-count mismatch
  // between script and TTS can squeeze one); later scenes shift right if needed.
  const minFrames = Math.max(1, frameAt(minScene / 2));
  const timed: TimedScene[] = [];
  let cursor = 0;
  scenes.forEach((scene, i) => {
    const start = Math.max(cursor, frameAt(startsMs[i]!));
    const next = i + 1 < scenes.length ? frameAt(startsMs[i + 1]!) : frameAt(endMs);
    const duration = Math.max(minFrames, next - start);
    timed.push({
      id: scene.id,
      visual: scene.visual,
      onScreenText: scene.onScreenText,
      imageUrl: scene.imageUrl,
      startFrame: start,
      durationFrames: duration,
    });
    cursor = start + duration;
  });
  return { scenes: timed, durationInFrames: Math.max(cursor, frameAt(endMs)) };
}

/** Groups words into short caption lines (≤ `maxWords`, broken at sentence ends). */
export function captionLines(words: CaptionWord[], maxWords = 6): CaptionWord[][] {
  const lines: CaptionWord[][] = [];
  let line: CaptionWord[] = [];
  for (const w of words) {
    line.push(w);
    if (line.length >= maxWords || /[.!?:;]$/.test(w.word)) {
      lines.push(line);
      line = [];
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/** "00:00 Intro" chapter lines for the YouTube description (long videos, FR-VID-4). */
export function youTubeChapters(scenes: Array<{ startFrame: number; onScreenText: string }>, fps: number): string[] {
  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const out: string[] = [];
  let lastSecond = -10;
  for (const scene of scenes) {
    const second = out.length === 0 ? 0 : Math.floor(scene.startFrame / fps);
    // YouTube needs ≥ 3 chapters, the first at 00:00, each ≥ 10 s long.
    if (second - lastSecond < 10) continue;
    out.push(`${fmt(second)} ${scene.onScreenText.replace(/\s+/g, " ").trim().slice(0, 60)}`);
    lastSecond = second;
  }
  return out.length >= 3 ? out : [];
}
