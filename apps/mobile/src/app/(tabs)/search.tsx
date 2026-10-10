import type { SearchResult } from "@repo/contracts";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, TextInput, View } from "react-native";
import { ArticleCard } from "../../components/article-card";
import { ErrorView, Loading, Message } from "../../components/ui";
import { SPACE, usePalette } from "../../lib/theme";
import { useApp } from "../../state/app-context";

/** Site search (FR-WEB-7) over reviews, comparisons and lists; debounced as you type. */
export default function SearchScreen() {
  const { api, t } = useApp();
  const c = usePalette();
  const [q, setQ] = useState("");
  const [attempt, setAttempt] = useState(0);
  // Results are tagged with the query they answer, so a stale response never shows for a new query.
  const [answer, setAnswer] = useState<{ q: string; data: SearchResult[] | null; error: unknown } | null>(null);
  const query = q.trim();

  useEffect(() => {
    if (query.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search(query, { limit: 30 }).then(
        (res) => !cancelled && setAnswer({ q: query, data: res.data, error: null }),
        (error: unknown) => !cancelled && setAnswer({ q: query, data: null, error }),
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query, attempt]);

  const current = answer?.q === query ? answer : null;
  const results = query.length < 2 ? null : (current?.data ?? null);
  const error = current?.error ?? null;
  const loading = query.length >= 2 && !current;

  return (
    <View style={styles.flex}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder={t("search.placeholder")}
        placeholderTextColor={c.muted}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel={t("tabs.search")}
        style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: c.border }]}
      />
      {error ? (
        <ErrorView
          error={error}
          onRetry={() => {
            setAnswer(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : loading ? (
        <Loading />
      ) : results === null ? (
        <Message>{t("search.hint")}</Message>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => `${r.type}:${r.slug}`}
          keyboardDismissMode="on-drag"
          ListEmptyComponent={<Message>{t("search.empty", { q: query })}</Message>}
          renderItem={({ item }) => (
            <ArticleCard
              item={{
                type: item.type,
                slug: item.slug,
                title: item.title,
                description: item.description,
                score: item.score,
                subtitle: item.category?.name,
                imageUrl: item.logo?.url ?? item.image?.url,
              }}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  input: {
    margin: SPACE.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    fontSize: 16,
  },
});
