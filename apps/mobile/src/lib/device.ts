import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { ApiError, type MobileApi } from "./api";
import type { AppLocale } from "./i18n";

/**
 * Anonymous device identity (FR-API-4). The token from POST /v1/devices lives in the keychain /
 * keystore; it is the only credential and never leaves the device except to our API.
 */
const TOKEN_KEY = "aireview.deviceToken";

/** In-memory copy so API calls skip the keychain after the first read. */
let cached: string | null = null;

export async function readDeviceToken(): Promise<string | null> {
  cached ??= await SecureStore.getItemAsync(TOKEN_KEY);
  return cached;
}

export async function clearDeviceToken() {
  cached = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

const platform = (): "ios" | "android" | "web" =>
  Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

/** Returns a working device token, registering this install when there is none (or it was deleted). */
export async function ensureDevice(api: MobileApi, locale: AppLocale): Promise<string> {
  const existing = await readDeviceToken();
  if (existing) {
    try {
      const device = await api.getDevice();
      if (device.locale !== locale) await api.updateDevice({ locale });
      return existing;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) return existing;
    }
  }
  const registered = await api.registerDevice({
    platform: platform(),
    locale,
    appVersion: Constants.expoConfig?.version,
  });
  await SecureStore.setItemAsync(TOKEN_KEY, registered.token);
  cached = registered.token;
  return registered.token;
}
