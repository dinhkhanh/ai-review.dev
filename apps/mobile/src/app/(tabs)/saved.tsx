import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl } from "react-native";
import { ArticleCard } from "../../components/article-card";
import { Message } from "../../components/ui";
import { useApp } from "../../state/app-context";

/** Saved articles (FR-API-4), stored server-side against this anonymous device. */
export default function SavedScreen() {
  const { saved, reloadMine, t } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    reloadMine()
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [reloadMine]);
  useFocusEffect(
    useCallback(() => {
      reloadMine().catch(() => {});
    }, [reloadMine]),
  );
  return (
    <FlatList
      data={saved}
      keyExtractor={(s) => s.articleId}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      contentContainerStyle={saved.length === 0 ? { flex: 1 } : undefined}
      ListEmptyComponent={<Message>{t("saved.empty")}</Message>}
      renderItem={({ item }) => (
        <ArticleCard
          item={{
            type: item.type,
            slug: item.slug,
            title: item.title,
            description: item.description,
            score: item.score,
            subtitle: item.productName,
          }}
        />
      )}
    />
  );
}
