import { Stack, useLocalSearchParams } from "expo-router";
import { FlatList, RefreshControl } from "react-native";
import { ArticleCard } from "../../components/article-card";
import { ErrorView, Loading, Message } from "../../components/ui";
import { useApp, useLoader } from "../../state/app-context";

/** Reviews in one category. */
export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { api, t } = useApp();
  const { data, error, loading, reload } = useLoader(() => api.getCategory(slug), `category:${slug}`);
  if (!data && loading) return <Loading />;
  if (!data) return <ErrorView error={error} onRetry={reload} />;
  return (
    <>
      <Stack.Screen options={{ title: data.name }} />
      <FlatList
        data={data.reviews}
        keyExtractor={(r) => r.slug}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
        ListEmptyComponent={<Message>{t("home.empty")}</Message>}
        renderItem={({ item }) => (
          <ArticleCard
            item={{
              type: "review",
              slug: item.slug,
              title: item.title,
              description: item.description,
              score: item.score,
              imageUrl: item.logo?.url,
            }}
          />
        )}
      />
    </>
  );
}
