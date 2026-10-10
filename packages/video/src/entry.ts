import { registerRoot } from "remotion";
import { RemotionRoot } from "./compositions/Root";

/** Remotion entry point, bundled by `bundleProject()` (src/render.ts) or `pnpm --filter @repo/video bundle`. */
registerRoot(RemotionRoot);
