import * as Notifications from "expo-notifications";
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { redirectSystemPath } from "../lib/links";
import { AppProvider } from "../state/app-context";

/** Opens the article a price-alert push points at (its `url` is an aireview:// deep link). */
function useNotificationRouting() {
  useEffect(() => {
    const go = (response: Notifications.NotificationResponse | null) => {
      const url = response?.notification.request.content.data?.url;
      if (typeof url === "string") router.push(redirectSystemPath(url) as Href);
    };
    Notifications.getLastNotificationResponseAsync()
      .then(go)
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, []);
}

export default function RootLayout() {
  const scheme = useColorScheme();
  useNotificationRouting();
  return (
    <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <AppProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="reviews/[slug]" options={{ title: "" }} />
          <Stack.Screen name="guides/[type]/[slug]" options={{ title: "" }} />
          <Stack.Screen name="categories/[slug]" options={{ title: "" }} />
        </Stack>
      </AppProvider>
    </ThemeProvider>
  );
}
