// Expo's default config detects the pnpm workspace (SDK 52+): it watches the repo root and resolves
// workspace packages (@repo/*), which export TypeScript source that Metro transpiles.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
