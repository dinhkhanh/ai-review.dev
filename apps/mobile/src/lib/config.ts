/** Build-time configuration (Expo inlines EXPO_PUBLIC_* variables when bundling). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://api.ai-review.dev").replace(/\/$/, "");
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || "https://ai-review.dev").replace(/\/$/, "");
