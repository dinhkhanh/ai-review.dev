// Expo's default config detects the pnpm workspace (SDK 52+): it watches the repo root and resolves
// workspace packages (@repo/*), which export TypeScript source that Metro transpiles. Sentry's
// wrapper only adds debug ids to bundles so uploaded source maps match crash reports.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
