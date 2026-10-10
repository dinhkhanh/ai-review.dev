import type { PriceAlert, SavedItem } from "@repo/contracts";
import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createMobileApi, type MobileApi } from "../lib/api";
import { API_URL } from "../lib/config";
import { clearDeviceToken, ensureDevice, readDeviceToken } from "../lib/device";
import { pickLocale, translate, type AppLocale, type MessageKey } from "../lib/i18n";
import type { ArticleType } from "../lib/links";
import { getPushToken, pushPermission, type PushPermission } from "../lib/push";

/**
 * App-wide state: locale and messages, the API client, the anonymous device, saved items and
 * price alerts. Reading works before the device is registered; the first write registers it.
 */
interface AppState {
  locale: AppLocale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  api: MobileApi;
  saved: SavedItem[];
  alerts: PriceAlert[];
  push: PushPermission;
  isSaved: (type: ArticleType, slug: string) => SavedItem | undefined;
  isFollowing: (productSlug: string) => boolean;
  toggleSave: (type: ArticleType, slug: string) => Promise<void>;
  toggleFollow: (productSlug: string) => Promise<void>;
  /** Asks for notification permission and registers the push token. */
  enablePush: () => Promise<boolean>;
  reloadMine: () => Promise<void>;
  deleteMyData: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

const deviceLocale = () => pickLocale(getLocales().map((l) => l.languageTag));

/** Saved items and alerts of an already-registered device; empty lists before registration. */
async function loadMine(api: MobileApi): Promise<[SavedItem[], PriceAlert[]]> {
  if (!(await readDeviceToken())) return [[], []];
  const [s, a] = await Promise.all([api.listSaved(), api.listAlerts()]);
  return [s.data, a.data];
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale] = useState(deviceLocale);
  const [api] = useState(() => createMobileApi({ baseUrl: API_URL, locale, getToken: readDeviceToken }));
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [push, setPush] = useState<PushPermission>("undetermined");

  const device = useCallback(() => ensureDevice(api, locale), [api, locale]);

  const reloadMine = useCallback(async () => {
    const [s, a] = await loadMine(api);
    setSaved(s);
    setAlerts(a);
  }, [api]);

  useEffect(() => {
    loadMine(api)
      .then(([s, a]) => {
        setSaved(s);
        setAlerts(a);
      })
      .catch(() => {});
    pushPermission()
      .then(async (status) => {
        setPush(status);
        // Keep the server's push token current when permission was granted earlier.
        if (status === "granted" && (await readDeviceToken())) {
          const token = await getPushToken(false);
          if (token) await api.updateDevice({ pushToken: token });
        }
      })
      .catch(() => {});
  }, [api]);

  const enablePush = useCallback(async () => {
    const token = await getPushToken(true);
    setPush(await pushPermission());
    if (!token) return false;
    await device();
    await api.updateDevice({ pushToken: token });
    return true;
  }, [api, device]);

  const toggleSave = useCallback(
    async (type: ArticleType, slug: string) => {
      await device();
      const existing = saved.find((s) => s.type === type && s.slug === slug && s.locale === locale);
      const res = existing ? await api.unsave(existing.articleId) : await api.save({ type, slug, locale });
      setSaved(res.data);
    },
    [api, device, locale, saved],
  );

  const toggleFollow = useCallback(
    async (productSlug: string) => {
      await device();
      const following = alerts.some((a) => a.productSlug === productSlug);
      const res = following ? await api.unfollow(productSlug) : await api.follow(productSlug);
      setAlerts(res.data);
      // Following is pointless without notifications: ask once, right after the tap.
      if (!following && push === "undetermined") await enablePush().catch(() => false);
    },
    [alerts, api, device, enablePush, push],
  );

  const deleteMyData = useCallback(async () => {
    if (await readDeviceToken()) await api.deleteDevice().catch(() => {});
    await clearDeviceToken();
    setSaved([]);
    setAlerts([]);
  }, [api]);

  const value = useMemo<AppState>(
    () => ({
      locale,
      t: (key, vars) => translate(locale, key, vars),
      api,
      saved,
      alerts,
      push,
      isSaved: (type, slug) => saved.find((s) => s.type === type && s.slug === slug && s.locale === locale),
      isFollowing: (productSlug) => alerts.some((a) => a.productSlug === productSlug),
      toggleSave,
      toggleFollow,
      enablePush,
      reloadMine,
      deleteMyData,
    }),
    [locale, api, saved, alerts, push, toggleSave, toggleFollow, enablePush, reloadMine, deleteMyData],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}

/**
 * Minimal async loader for screens (no data library needed). `key` identifies what is loaded;
 * a new key or `reload()` fetches again, keeping the previous data visible while refreshing.
 */
export function useLoader<T>(load: () => Promise<T>, key: string) {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [nonce, setNonce] = useState(0);
  const token = `${key}#${nonce}`;
  const [state, setState] = useState<{ token: string; data: T | null; error: unknown }>({
    token: "",
    data: null,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => !cancelled && setState({ token, data, error: null }),
      (error: unknown) => !cancelled && setState((s) => ({ token, data: s.data, error })),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const loading = state.token !== token;
  return {
    data: state.token.startsWith(`${key}#`) ? state.data : null,
    error: loading ? null : state.error,
    loading,
    reload,
  };
}
