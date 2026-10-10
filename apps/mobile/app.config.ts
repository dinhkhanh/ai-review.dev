import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * AI Review mobile app (FR-API-4). Identifiers come from the environment so the same config serves
 * local development and EAS builds; the web app serves the matching universal/app-link files from
 * the same IOS_BUNDLE_ID / ANDROID_PACKAGE values (apps/web/app/.well-known).
 */
const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID || "dev.aireview.app";
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || "dev.aireview.app";
const SITE_HOST = new URL(process.env.EXPO_PUBLIC_SITE_URL || "https://ai-review.dev").host;
const LINK_PREFIXES = [
  "/reviews",
  "/compare",
  "/alternatives",
  "/best",
  "/de/reviews",
  "/de/compare",
  "/de/alternatives",
  "/de/best",
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "AI Review",
  slug: "ai-review",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "aireview",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    supportsTablet: true,
    associatedDomains: [`applinks:${SITE_HOST}`],
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: LINK_PREFIXES.map((pathPrefix) => ({ scheme: "https", host: SITE_HOST, pathPrefix })),
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: { favicon: "./assets/images/favicon.png" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-localization",
    ["expo-notifications", { color: "#208AEF" }],
    ["expo-splash-screen", { backgroundColor: "#208AEF", image: "./assets/images/splash-icon.png", imageWidth: 76 }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
