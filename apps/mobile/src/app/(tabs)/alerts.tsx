import { Link, type Href } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Message, SectionTitle } from "../../components/ui";
import { SPACE, usePalette } from "../../lib/theme";
import { useApp } from "../../state/app-context";

/** Price alerts (FR-API-4) plus privacy settings: notification status, followed products, delete data. */
export default function AlertsScreen() {
  const { alerts, push, enablePush, toggleFollow, deleteMyData, t } = useApp();
  const c = usePalette();

  const confirmDelete = () =>
    Alert.alert(t("settings.delete"), t("settings.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.delete"),
        style: "destructive",
        onPress: () => void deleteMyData().then(() => Alert.alert(t("settings.deleted"))),
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SectionTitle>{t("alerts.title")}</SectionTitle>
      {push !== "granted" && push !== "unsupported" ? (
        <View style={[styles.banner, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={{ color: c.text }}>{t("alerts.pushOff")}</Text>
          <Button label={t("alerts.enable")} onPress={() => void enablePush()} />
        </View>
      ) : null}
      {alerts.length === 0 ? (
        <Message>{t("alerts.empty")}</Message>
      ) : (
        alerts.map((a) => (
          <View key={a.productSlug} style={[styles.row, { borderColor: c.border }]}>
            <View style={styles.flex}>
              {a.reviewSlug ? (
                <Link href={`/reviews/${a.reviewSlug}` as Href} asChild>
                  <Pressable accessibilityRole="link">
                    <Text style={[styles.name, { color: c.text }]}>{a.productName}</Text>
                  </Pressable>
                </Link>
              ) : (
                <Text style={[styles.name, { color: c.text }]}>{a.productName}</Text>
              )}
              {a.lastChange ? (
                <Text style={{ color: c.muted }}>{t("alerts.lastChange", { summary: a.lastChange.summary })}</Text>
              ) : null}
            </View>
            <Button variant="secondary" label={t("alerts.unfollow")} onPress={() => void toggleFollow(a.productSlug)} />
          </View>
        ))
      )}

      <SectionTitle>{t("settings.title")}</SectionTitle>
      <Text style={[styles.privacy, { color: c.muted }]}>{t("settings.privacy")}</Text>
      <Button variant="secondary" label={t("settings.delete")} onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACE.lg, gap: SPACE.md },
  banner: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: SPACE.lg, gap: SPACE.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    paddingVertical: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: "600" },
  privacy: { fontSize: 14, lineHeight: 20 },
});
