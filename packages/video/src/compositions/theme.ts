import type { VideoTheme } from "../types";

/** Score colour bands; mirrors `tokens.scoreBands` in @repo/ui (dark-friendly shades). */
export function scoreColor(score: number, theme: VideoTheme): string {
  if (score >= 8.5) return theme.success;
  if (score >= 7) return theme.accent;
  if (score >= 5.5) return theme.warning;
  return theme.danger;
}

export function formatPrice(tier: { price: number | null; currency: string; period: string }): string {
  if (tier.price === null) return "Custom";
  if (tier.price === 0) return "Free";
  const symbol = tier.currency === "USD" ? "$" : tier.currency === "EUR" ? "€" : tier.currency === "GBP" ? "£" : "";
  const amount = Number.isInteger(tier.price) ? String(tier.price) : tier.price.toFixed(2);
  const suffix = { month: "/mo", year: "/yr", one_time: " once", usage: " usage", custom: "" }[tier.period] ?? "";
  return `${symbol || `${tier.currency} `}${amount}${suffix}`;
}
