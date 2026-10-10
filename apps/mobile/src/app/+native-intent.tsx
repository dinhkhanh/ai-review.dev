import { redirectSystemPath as mapPath } from "../lib/links";

/**
 * Rewrites incoming deep links and universal links before routing (FR-API-4):
 * `https://ai-review.dev/de/compare/a-vs-b` → `/guides/comparison/a-vs-b?locale=de`.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return mapPath(path);
}
