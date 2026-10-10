import { Link, type Href } from "expo-router";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArticleCard } from "../../components/article-card";
import { ErrorView, Loading, Message, SectionTitle } from "../../components/ui";
import { SPACE, usePalette } from "../../lib/theme";
import { useApp, useLoader } from "../../state/app-context";

/** Home: latest reviews and category shortcuts. */
export default function HomeScreen() {
  const { api, t } = useApp();
  const c = usePalette();
  const { data, error, loading, reload } = useLoader(
    () => Promise.all([api.listReviews({ limit: 30 }), api.listCategories()]),
    "home",
  );
  if (!data && loading) return <Loading />;
  if (!data) return <ErrorView error={error} onRetry={reload} />;
  const [reviews, categories] = data;
  return (
    <FlatList
      data={reviews.data}
      keyExtractor={(r) => r.slug}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          {categories.data.length > 0 ? (
            <>
              <SectionTitle style={styles.pad}>{t("home.categories")}</SectionTitle>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {categories.data.map((cat) => (
                  <Link key={cat.slug} href={`/categories/${cat.slug}` as Href} asChild>
                    <Pressable style={[styles.chip, { backgroundColor: c.surface, borderColor: c.border }]}>
                      <Text style={{ color: c.text }}>{cat.name}</Text>
                    </Pressable>
                  </Link>
                ))}
              </ScrollView>
            </>
          ) : null}
          <SectionTitle style={styles.pad}>{t("home.latest")}</SectionTitle>
        </View>
      }
      ListEmptyComponent={<Message>{t("home.empty")}</Message>}
      renderItem={({ item }) => (
        <ArticleCard
          item={{
            type: "review",
            slug: item.slug,
            title: item.title,
            description: item.description,
            score: item.score,
            subtitle: item.category?.name,
            imageUrl: item.logo?.url,
          }}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: SPACE.lg },
  chips: { gap: SPACE.sm, paddingHorizontal: SPACE.lg },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
});
