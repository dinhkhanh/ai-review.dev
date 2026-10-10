import { Share, StyleSheet, Text, View } from "react-native";
import { formatScore } from "../lib/blocks";
import { formatDate } from "../lib/i18n";
import { SPACE, usePalette } from "../lib/theme";
import { useApp } from "../state/app-context";
import { Button, ScoreBadge } from "./ui";

/** Title block shared by reviews and guides: title, score, dates, disclosures and actions. */
export function ArticleHeader({
  title,
  score,
  lastVerifiedAt,
  author,
  aiDisclosure,
  showAffiliateDisclosure,
  webUrl,
  saved,
  onToggleSave,
  following,
  onToggleFollow,
}: {
  title: string;
  score?: number | null;
  lastVerifiedAt: string | null;
  author: string | null;
  aiDisclosure: string | null;
  showAffiliateDisclosure: boolean;
  webUrl: string;
  saved: boolean;
  onToggleSave: () => void;
  following?: boolean;
  onToggleFollow?: () => void;
}) {
  const c = usePalette();
  const { t, locale } = useApp();
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
        {title}
      </Text>
      <View style={styles.meta}>
        <ScoreBadge score={formatScore(score)} />
        <Text style={[styles.small, { color: c.muted }]}>
          {[author, lastVerifiedAt ? t("review.verified", { date: formatDate(lastVerifiedAt, locale) }) : null]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      {/* FTC / UWG: the disclosure sits above the first monetised link, as on the web. */}
      {showAffiliateDisclosure ? (
        <Text style={[styles.disclosure, { color: c.muted, borderColor: c.border }]}>{t("disclosure.affiliate")}</Text>
      ) : null}
      {aiDisclosure ? <Text style={[styles.small, { color: c.muted }]}>{aiDisclosure}</Text> : null}
      <View style={styles.actions}>
        <Button
          variant={saved ? "primary" : "secondary"}
          label={saved ? t("review.saved") : t("review.save")}
          onPress={onToggleSave}
          style={styles.action}
        />
        <Button
          variant="secondary"
          label="↗"
          accessibilityLabel={t("review.openWeb")}
          onPress={() => void Share.share({ url: webUrl, message: `${title} ${webUrl}` })}
        />
      </View>
      {onToggleFollow ? (
        <Button
          variant={following ? "primary" : "secondary"}
          label={following ? t("review.following") : t("review.follow")}
          onPress={onToggleFollow}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: SPACE.md, marginBottom: SPACE.lg },
  title: { fontSize: 28, fontWeight: "800", lineHeight: 34 },
  meta: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap" },
  small: { fontSize: 13, lineHeight: 18 },
  disclosure: {
    fontSize: 13,
    lineHeight: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: SPACE.sm,
  },
  actions: { flexDirection: "row", gap: SPACE.sm },
  action: { flex: 1 },
});
