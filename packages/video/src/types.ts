import type { SceneVisual } from "./visuals";

export type VideoKind = "short" | "long";

/** Frame sizes (FR-VID-3): short is vertical 9:16, long is 16:9. */
export const VIDEO_DIMENSIONS: Record<VideoKind, { width: number; height: number }> = {
  short: { width: 1080, height: 1920 },
  long: { width: 1920, height: 1080 },
};
export const VIDEO_FPS = 30;
export const COMPOSITION_IDS: Record<VideoKind, string> = { short: "Short", long: "Long" };

/** Brand colours for the compositions; mirrors the dark palette of @repo/ui tokens. */
export interface VideoTheme {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  brand: string;
  brandFg: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  font: string;
}

export const DEFAULT_THEME: VideoTheme = {
  bg: "#0b0f14",
  surface: "#121821",
  border: "#232c38",
  text: "#e8edf3",
  muted: "#9aa6b5",
  brand: "#8b84ff",
  brandFg: "#0b0f14",
  accent: "#2dd4bf",
  success: "#4ade80",
  warning: "#fbbf24",
  danger: "#f87171",
  font: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
};

export interface CaptionWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TimedScene {
  id: string;
  visual: SceneVisual;
  onScreenText: string;
  /** Resolved image URL for screenshot scenes. */
  imageUrl: string | null;
  startFrame: number;
  durationFrames: number;
}

/** Everything a composition renders. Serialisable: it travels to the headless browser as input props. */
// A type alias (not an interface) so it satisfies Remotion's Record<string, unknown> props constraint.
export type VideoInputProps = {
  kind: VideoKind;
  theme: VideoTheme;
  product: { name: string; logoUrl: string | null; category: string | null };
  title: string;
  score: number | null;
  verdict: { summary: string; bestFor: string[] };
  pricing: Array<{ name: string; price: number | null; currency: string; period: string }>;
  pros: string[];
  cons: string[];
  comparison: { products: string[]; rows: Array<{ label: string; values: string[] }> } | null;
  /** Display URL for the outro and its QR code (the article page, which carries the go-links). */
  goUrl: string;
  disclosure: string;
  scenes: TimedScene[];
  captions: CaptionWord[];
  audioUrl: string | null;
  /** Off by default: no music ships with the project (no copyrighted tracks). */
  musicUrl: string | null;
  /** Inter regular/bold served to the renderer; null falls back to system fonts. */
  fontUrls: { regular: string; bold: string } | null;
  durationInFrames: number;
};
