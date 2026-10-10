import { useColorScheme } from "react-native";

/** Colours matching the web design tokens (packages/ui), light and dark. */
export const COLORS = {
  light: {
    bg: "#ffffff",
    surface: "#f4f5f7",
    border: "#e3e5e8",
    text: "#111418",
    muted: "#5f6670",
    brand: "#208AEF",
    brandFg: "#ffffff",
    success: "#1f8a4c",
    warning: "#a86200",
    danger: "#c62f2f",
  },
  dark: {
    bg: "#0d0f12",
    surface: "#181b20",
    border: "#2a2e35",
    text: "#f2f4f7",
    muted: "#a3a9b3",
    brand: "#4aa3f5",
    brandFg: "#0d0f12",
    success: "#4cc283",
    warning: "#e0a040",
    danger: "#f06a6a",
  },
} as const;

export type Palette = { [K in keyof (typeof COLORS)["light"]]: string };

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? COLORS.dark : COLORS.light;
}

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
