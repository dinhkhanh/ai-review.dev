import { Image } from "expo-image";
import { Link, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatScore } from "../lib/blocks";
import { appRoute, type ArticleType } from "../lib/links";
import { SPACE, usePalette } from "../lib/theme";
import { useApp } from "../state/app-context";
import { ScoreBadge } from "./ui";

export interface CardData {
  type: ArticleType;
  slug: string;
  title: string;
  description: string | null;
  score: number | null;
  subtitle?: string | null;
  imageUrl?: string | null;
}

/** One article in a list: logo or image, title, description and score. */
export function ArticleCard({ item }: { item: CardData }) {
  const c = usePalette();
  const { locale } = useApp();
  const href = appRoute({ type: item.type, slug: item.slug, locale }) as Href;
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        style={({ pressed }) => [styles.card, { borderColor: c.border, backgroundColor: pressed ? c.surface : c.bg }]}
      >
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            style={styles.thumb}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <View style={styles.body}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text style={[styles.subtitle, { color: c.muted }]} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}
          {item.description ? (
            <Text style={[styles.description, { color: c.muted }]} numberOfLines={3}>
              {item.description}
            </Text>
          ) : null}
        </View>
        <ScoreBadge score={formatScore(item.score)} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: SPACE.md,
    padding: SPACE.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: "600" },
  subtitle: { fontSize: 13 },
  description: { fontSize: 14, lineHeight: 20, marginTop: 2 },
});
