import createClient from "openapi-fetch";
import type { paths } from "./generated/v1";

/**
 * Typed client for the public API v1 (FR-API-1), generated from the OpenAPI document. This is
 * what apps/mobile will import (NFR-13).
 *
 *   const api = createApiClient("https://api.ai-review.dev");
 *   const { data } = await api.GET("/v1/reviews/{slug}", { params: { path: { slug: "notion-review" } } });
 */
export function createApiClient(
  baseUrl: string,
  init: { fetch?: typeof fetch; headers?: Record<string, string> } = {},
) {
  return createClient<paths>({ baseUrl, fetch: init.fetch, headers: init.headers });
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type { paths, components } from "./generated/v1";
