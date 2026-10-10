import { Stack, useLocalSearchParams } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { ArticleHeader } from "../../components/article-header";
import { BlockRenderer } from "../../components/block-renderer";
import { ErrorView, Loading } from "../../components/ui";
import { hasMonetisedLinks } from "../../lib/blocks";
import { SITE_URL } from "../../lib/config";
import { webArticleUrl } from "../../lib/links";
import { SPACE } from "../../lib/theme";
import { useApp, useLoader } from "../../state/app-context";

/** Review reader (FR-API-4): native blocks, save, price alerts for the product. */
export default function ReviewScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { api, locale, isSaved, toggleSave, isFollowing, toggleFollow } = useApp();
  const { data, error, loading, reload } = useLoader(() => api.getReview(slug), `review:${slug}`);
  if (!data && loading) return <Loading />;
  if (!data) return <ErrorView error={error} onRetry={reload} />;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
    >
      <Stack.Screen options={{ title: data.product.name }} />
      <ArticleHeader
        title={data.title}
        score={data.score}
        lastVerifiedAt={data.lastVerifiedAt}
        author={data.author?.name ?? null}
        aiDisclosure={data.aiDisclosure}
        showAffiliateDisclosure={Boolean(data.links.go) || hasMonetisedLinks(data.blocks)}
        webUrl={data.links.web ?? webArticleUrl(SITE_URL, { type: "review", slug, locale })}
        saved={Boolean(isSaved("review", data.slug))}
        onToggleSave={() => void toggleSave("review", data.slug)}
        following={isFollowing(data.product.slug)}
        onToggleFollow={() => void toggleFollow(data.product.slug)}
      />
      <BlockRenderer
        blocks={data.blocks}
        ctx={{
          articleSlug: data.slug,
          goBaseUrl: data.links.goBaseUrl,
          sources: data.sources,
          media: data.media,
          videos: data.videos,
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ content: { padding: SPACE.lg, paddingBottom: SPACE.xl * 2 } });
