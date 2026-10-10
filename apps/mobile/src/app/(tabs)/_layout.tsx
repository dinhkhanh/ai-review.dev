import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { usePalette } from "../../lib/theme";
import { useApp } from "../../state/app-context";

type IconName = ComponentProps<typeof Ionicons>["name"];

const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  const { t } = useApp();
  const c = usePalette();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.brand }}>
      <Tabs.Screen name="index" options={{ title: t("tabs.home"), tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="search" options={{ title: t("tabs.search"), tabBarIcon: icon("search-outline") }} />
      <Tabs.Screen name="saved" options={{ title: t("tabs.saved"), tabBarIcon: icon("bookmark-outline") }} />
      <Tabs.Screen name="alerts" options={{ title: t("tabs.alerts"), tabBarIcon: icon("notifications-outline") }} />
    </Tabs>
  );
}
