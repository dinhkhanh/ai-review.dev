import { Stack, useLocalSearchParams } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { ArticleHeader } from "../../../components/article-header";
import { BlockRenderer } from "../../../components/block-renderer";
import { ErrorView, Loading, Message } from "../../../components/ui";
import { hasMonetisedLinks } from "../../../lib/blocks";
import type { GuideType } from "../../../lib/links";
import { SPACE } from "../../../lib/theme";
import { useApp, useLoader } from "../../../state/app-context";

const GUIDE_TYPES: GuideType[] = ["comparison", "alternatives", "best_of"];

/** Comparisons, alternatives and best-of lists (FR-CON-8) rendered natively. */
export default function GuideScreen() {
  const { type, slug } = useLocalSearchParams<{ type: string; slug: string }>();
  const { api, t, isSaved, toggleSave } = useApp();
  const valid = GUIDE_TYPES.includes(type as GuideType);
  const { data, error, loading, reload } = useLoader(
    () => (valid ? api.getGuide(type as GuideType, slug) : Promise.resolve(null)),
    `guide:${type}/${slug}`,
  );
  if (!valid) return <Message>{t("review.notFound")}</Message>;
  if (!data && loading) return <Loading />;
  if (!data) return <ErrorView error={error} onRetry={reload} />;
  const guideType = type as GuideType;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
    >
      <Stack.Screen options={{ title: "" }} />
      <ArticleHeader
        title={data.title}
        lastVerifiedAt={data.lastVerifiedAt}
        author={data.author?.name ?? null}
        aiDisclosure={data.aiDisclosure}
        showAffiliateDisclosure={data.products.some((p) => p.go) || hasMonetisedLinks(data.blocks)}
        webUrl={data.links.web}
        saved={Boolean(isSaved(guideType, data.slug))}
        onToggleSave={() => void toggleSave(guideType, data.slug)}
      />
      <BlockRenderer
        blocks={data.blocks}
        ctx={{
          articleSlug: data.slug,
          goBaseUrl: data.links.goBaseUrl,
          sources: data.sources,
          media: data.media,
          products: data.products,
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ content: { padding: SPACE.lg, paddingBottom: SPACE.xl * 2 } });
