import { config } from "@repo/eslint-config/react-internal";

/** `build/` holds the prebuilt Remotion bundle (pnpm --filter @repo/video bundle); not source. */
export default [{ ignores: ["build/**"] }, ...config];
