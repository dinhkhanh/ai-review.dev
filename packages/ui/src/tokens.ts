/**
 * Design tokens shared by web (Tailwind), graphics (Satori) and, later, mobile (NativeWind).
 * Plain data only — no CSS or React — so every renderer can consume it.
 */
export const tokens = {
  color: {
    light: {
      bg: "#ffffff",
      surface: "#f6f7f9",
      border: "#e3e6eb",
      text: "#0f1720",
      muted: "#5b6573",
      brand: "#4f46e5",
      brandFg: "#ffffff",
      accent: "#0ea5a4",
      success: "#15803d",
      warning: "#b45309",
      danger: "#b91c1c",
    },
    dark: {
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
    },
  },
  radius: { sm: 6, md: 10, lg: 16, full: 9999 },
  font: {
    sans: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  /** Score -> colour band used on badges and OG images. */
  scoreBands: [
    { min: 8.5, label: "Excellent", color: "#15803d" },
    { min: 7, label: "Good", color: "#0ea5a4" },
    { min: 5.5, label: "Average", color: "#b45309" },
    { min: 0, label: "Poor", color: "#b91c1c" },
  ],
} as const;

export function scoreBand(score: number) {
  return tokens.scoreBands.find((b) => score >= b.min) ?? tokens.scoreBands[tokens.scoreBands.length - 1]!;
}
