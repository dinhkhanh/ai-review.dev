import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { ApiError } from "../lib/api";
import { SPACE, usePalette } from "../lib/theme";
import { useApp } from "../state/app-context";

export function Loading() {
  const c = usePalette();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={c.brand} />
    </View>
  );
}

export function Message({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; onPress: () => void };
}) {
  const c = usePalette();
  return (
    <View style={styles.center}>
      <Text style={[styles.message, { color: c.muted }]}>{children}</Text>
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

/** Error state with a retry; 404s read as "not available" rather than as a failure. */
export function ErrorView({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useApp();
  if (error instanceof ApiError && error.status === 404) return <Message>{t("review.notFound")}</Message>;
  const offline = error instanceof TypeError;
  return (
    <Message action={{ label: t("common.retry"), onPress: onRetry }}>
      {offline ? t("error.offline") : t("error.generic")}
    </Message>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const c = usePalette();
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? c.brand : c.surface,
          borderColor: primary ? c.brand : c.border,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? c.brandFg : c.text }]}>{label}</Text>
    </Pressable>
  );
}

export function SectionTitle({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const c = usePalette();
  return <Text style={[styles.sectionTitle, { color: c.text }, style]}>{children}</Text>;
}

export function ScoreBadge({ score }: { score: string | null }) {
  const c = usePalette();
  if (!score) return null;
  return (
    <View style={[styles.score, { backgroundColor: c.brand }]}>
      <Text style={[styles.scoreText, { color: c.brandFg }]}>{score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACE.xl, gap: SPACE.lg },
  message: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  button: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.lg,
    alignItems: "center",
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  sectionTitle: { fontSize: 20, fontWeight: "700", marginTop: SPACE.xl, marginBottom: SPACE.sm },
  score: { borderRadius: 8, paddingHorizontal: SPACE.sm, paddingVertical: 2, alignSelf: "flex-start" },
  scoreText: { fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
