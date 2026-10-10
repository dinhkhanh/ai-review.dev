import type {
  Category,
  Device,
  DevicePlatform,
  DeviceRegisterResponse,
  DeviceUpdateRequest,
  GuideDetail,
  PriceAlert,
  ReviewDetail,
  ReviewSummary,
  SavedItem,
  SearchResult,
} from "@repo/contracts";
import type { AppLocale } from "./i18n";
import type { ArticleType, GuideType } from "./links";

/**
 * Thin client for the public API v1 (FR-API-1, FR-API-4). Types come from @repo/contracts as
 * type-only imports, so Metro never bundles the server-side schema library. Locale is sent as
 * `locale=de` for German devices; English requests omit it.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  baseUrl: string;
  locale: AppLocale;
  /** Device token for /devices/me and /me/* (Bearer). */
  getToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
}

/** Category with its reviews (CategoryDetailSchema in @repo/contracts). */
export type CategoryDetail = Category & { reviews: ReviewSummary[] };

type Query = Record<string, string | number | undefined | null>;

interface Paginated<T> {
  data: T[];
  pagination: { limit: number; offset: number; total: number | null };
}

export function createMobileApi(opts: ApiOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    init: { query?: Query; body?: unknown; auth?: boolean; localized?: boolean } = {},
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query ?? {}))
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    if (init.localized && opts.locale !== "en") params.set("locale", opts.locale);
    const qs = params.toString();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.auth) {
      const token = await opts.getToken?.();
      if (!token) throw new ApiError(401, "unauthorized", "Device is not registered");
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await doFetch(`${base}/v1${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) {
      throw new ApiError(res.status, json?.error?.code ?? "http_error", json?.error?.message ?? `HTTP ${res.status}`);
    }
    return json as T;
  }

  return {
    // Public reads
    listReviews: (q: { category?: string; limit?: number; offset?: number } = {}) =>
      request<Paginated<ReviewSummary>>("GET", "/reviews", { query: q, localized: true }),
    getReview: (slug: string) =>
      request<ReviewDetail>("GET", `/reviews/${encodeURIComponent(slug)}`, { localized: true }),
    getGuide: (type: GuideType, slug: string) =>
      request<GuideDetail>("GET", `/guides/${type}/${encodeURIComponent(slug)}`, { localized: true }),
    listCategories: () => request<{ data: Category[] }>("GET", "/categories", { localized: true }),
    getCategory: (slug: string) =>
      request<CategoryDetail>("GET", `/categories/${encodeURIComponent(slug)}`, { localized: true }),
    search: (q: string, more: { type?: ArticleType; limit?: number } = {}) =>
      request<Paginated<SearchResult>>("GET", "/search", { query: { q, ...more }, localized: true }),

    // Device (FR-API-4)
    registerDevice: (body: { platform: DevicePlatform; locale: AppLocale; appVersion?: string; pushToken?: string }) =>
      request<DeviceRegisterResponse>("POST", "/devices", { body }),
    getDevice: () => request<Device>("GET", "/devices/me", { auth: true }),
    updateDevice: (body: DeviceUpdateRequest) => request<Device>("PATCH", "/devices/me", { body, auth: true }),
    deleteDevice: () => request<void>("DELETE", "/devices/me", { auth: true }),

    listSaved: () => request<{ data: SavedItem[] }>("GET", "/me/saved", { auth: true }),
    save: (body: { type: ArticleType; slug: string; locale: AppLocale }) =>
      request<{ data: SavedItem[] }>("POST", "/me/saved", { body, auth: true }),
    unsave: (articleId: string) =>
      request<{ data: SavedItem[] }>("DELETE", `/me/saved/${encodeURIComponent(articleId)}`, { auth: true }),

    listAlerts: () => request<{ data: PriceAlert[] }>("GET", "/me/alerts", { auth: true }),
    follow: (productSlug: string) =>
      request<{ data: PriceAlert[] }>("POST", "/me/alerts", { body: { product: productSlug }, auth: true }),
    unfollow: (productSlug: string) =>
      request<{ data: PriceAlert[] }>("DELETE", `/me/alerts/${encodeURIComponent(productSlug)}`, { auth: true }),
  };
}

export type MobileApi = ReturnType<typeof createMobileApi>;
