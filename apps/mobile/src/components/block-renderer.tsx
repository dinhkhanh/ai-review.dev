import type { Block, Inline } from "@repo/content";
import type { Image as ApiImage, ReviewDetail, Video } from "@repo/contracts";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  comparisonHeaders,
  formatScore,
  formatTierPrice,
  inlineSegments,
  inlineText,
  numberSources,
  type Segment,
} from "../lib/blocks";
import { formatDate } from "../lib/i18n";
import { goLinkUrl } from "../lib/links";
import { SPACE, usePalette, type Palette } from "../lib/theme";
import { useApp } from "../state/app-context";
import { Button, ScoreBadge } from "./ui";

/**
 * Native renderer for portable article blocks (constraint C-1, NFR-13). Mirrors the web renderer:
 * citations are numbered markers that open the source, go-links open through `/go/:slug` with
 * placement `app`, comparison tables scroll horizontally on narrow screens.
 */
type Source = ReviewDetail["sources"][number];

export interface BlockContext {
  articleSlug: string;
  goBaseUrl: string;
  sources: Source[];
  media: Record<string, ApiImage>;
  videos?: Video[];
  products?: Array<{ id: string; name: string }>;
}

const open = (url: string) => void WebBrowser.openBrowserAsync(url).catch(() => {});

export function BlockRenderer({ blocks, ctx }: { blocks: Block[]; ctx: BlockContext }) {
  const numbers = useMemo(
    () =>
      numberSources(
        blocks,
        ctx.sources.map((s) => s.id),
      ),
    [blocks, ctx.sources],
  );
  return (
    <View style={styles.blocks}>
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} ctx={ctx} numbers={numbers} />
      ))}
    </View>
  );
}

function Rich({
  inlines,
  ctx,
  numbers,
  style,
}: {
  inlines: Inline[];
  ctx: BlockContext;
  numbers: Map<string, number>;
  style?: object;
}) {
  const c = usePalette();
  const segments = inlineSegments(inlines, numbers);
  const sourceUrls = new Map(ctx.sources.map((s) => [numbers.get(s.id) ?? 0, s.url]));
  return (
    <Text style={[styles.body, { color: c.text }, style]}>
      {segments.map((seg, i) => (
        <SegmentText key={i} seg={seg} ctx={ctx} c={c} sourceUrls={sourceUrls} />
      ))}
    </Text>
  );
}

function SegmentText({
  seg,
  ctx,
  c,
  sourceUrls,
}: {
  seg: Segment;
  ctx: BlockContext;
  c: Palette;
  sourceUrls: Map<number, string>;
}) {
  if (seg.citation) {
    const url = sourceUrls.get(seg.citation);
    return (
      <Text
        style={[styles.citation, { color: c.brand }]}
        onPress={url ? () => open(url) : undefined}
        accessibilityRole="link"
        accessibilityLabel={`Source ${seg.citation}`}
      >
        {` [${seg.citation}]`}
      </Text>
    );
  }
  const style = [
    seg.bold && styles.bold,
    seg.italic && styles.italic,
    seg.code && [styles.code, { backgroundColor: c.surface }],
    (seg.href || seg.goSlug) && { color: c.brand, textDecorationLine: "underline" as const },
  ];
  const target = seg.goSlug ? goLinkUrl(ctx.goBaseUrl, seg.goSlug, ctx.articleSlug) : seg.href;
  return (
    <Text
      style={style}
      onPress={target ? () => open(target) : undefined}
      accessibilityRole={target ? "link" : undefined}
    >
      {seg.text}
    </Text>
  );
}

function BlockView({ block, ctx, numbers }: { block: Block; ctx: BlockContext; numbers: Map<string, number> }) {
  const c = usePalette();
  const { t, locale } = useApp();
  switch (block.type) {
    case "heading":
      return (
        <Text accessibilityRole="header" style={[block.level === 2 ? styles.h2 : styles.h3, { color: c.text }]}>
          {block.text}
        </Text>
      );
    case "paragraph":
      return <Rich inlines={block.children} ctx={ctx} numbers={numbers} />;
    case "list":
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={[styles.body, { color: c.muted }]}>{block.ordered ? `${i + 1}.` : "•"}</Text>
              <Rich inlines={item} ctx={ctx} numbers={numbers} style={styles.flex} />
            </View>
          ))}
        </View>
      );
    case "verdict":
      return (
        <View style={[styles.panel, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.row}>
            <Text style={[styles.h3, styles.flex, { color: c.text }]}>{t("review.verdict")}</Text>
            <ScoreBadge score={formatScore(block.score)} />
          </View>
          <Text style={[styles.body, { color: c.text }]}>{block.summary}</Text>
          <Bullets title={t("review.bestFor")} items={block.bestFor} tone={c.success} />
          <Bullets title={t("review.notFor")} items={block.notFor} tone={c.danger} />
        </View>
      );
    case "rubric":
      return (
        <View style={styles.list}>
          {block.dimensions.map((d) => (
            <View key={d.key} style={[styles.rubricRow, { borderColor: c.border }]}>
              <View style={styles.row}>
                <Text style={[styles.bold, styles.flex, { color: c.text }]}>{d.label}</Text>
                <Text style={[styles.bold, { color: c.text }]}>{formatScore(d.score)}</Text>
              </View>
              <View style={[styles.bar, { backgroundColor: c.border }]}>
                <View
                  style={[styles.barFill, { backgroundColor: c.brand, width: `${Math.min(100, d.score * 10)}%` }]}
                />
              </View>
              <Text style={[styles.small, { color: c.muted }]}>{d.justification}</Text>
            </View>
          ))}
        </View>
      );
    case "pricing_table":
      return (
        <View style={styles.list}>
          {block.tiers.map((tier) => (
            <View key={tier.name} style={[styles.panel, { borderColor: c.border }]}>
              <View style={styles.row}>
                <Text style={[styles.h3, styles.flex, { color: c.text }]}>{tier.name}</Text>
                <Text style={[styles.price, { color: c.text }]}>{formatTierPrice(tier, locale)}</Text>
              </View>
              {tier.highlights.map((h, i) => (
                <Text key={i} style={[styles.small, { color: c.muted }]}>
                  • {h}
                </Text>
              ))}
            </View>
          ))}
          <Text style={[styles.small, { color: c.muted }]}>
            {t("review.verified", { date: formatDate(block.verifiedAt, locale) })}
          </Text>
        </View>
      );
    case "pros_cons":
      return (
        <View style={styles.list}>
          <Bullets title={t("review.pros")} items={block.pros} tone={c.success} mark="+" />
          <Bullets title={t("review.cons")} items={block.cons} tone={c.danger} mark="−" />
        </View>
      );
    case "comparison_table":
      return <ComparisonTable block={block} ctx={ctx} />;
    case "image": {
      const img = ctx.media[block.assetId];
      if (!img) return null;
      const variant = img.variants.find((v) => v.width >= 720) ?? img.variants.at(-1);
      const ratio = img.width && img.height ? img.width / img.height : 16 / 9;
      return (
        <View style={styles.list}>
          <Image
            source={{ uri: variant?.url ?? img.url }}
            style={[styles.image, { aspectRatio: ratio, backgroundColor: c.surface }]}
            contentFit="contain"
            accessibilityLabel={img.alt ?? block.caption ?? undefined}
          />
          {block.caption ? <Text style={[styles.small, { color: c.muted }]}>{block.caption}</Text> : null}
        </View>
      );
    }
    case "video": {
      const video = ctx.videos?.find((v) => v.kind === "long") ?? ctx.videos?.[0];
      if (!video) return null;
      return (
        <Pressable accessibilityRole="link" onPress={() => open(video.watchUrl)} style={styles.list}>
          <Image
            source={{ uri: video.thumbnailUrl }}
            style={[styles.image, { aspectRatio: 16 / 9 }]}
            contentFit="cover"
          />
          <Text style={[styles.bold, { color: c.brand }]}>▶ {t("review.watch")}</Text>
        </Pressable>
      );
    }
    case "faq":
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <FaqItem key={i} question={item.question}>
              <Rich inlines={item.answer} ctx={ctx} numbers={numbers} />
            </FaqItem>
          ))}
        </View>
      );
    case "cta":
      return (
        <View style={styles.list}>
          <Button label={block.label} onPress={() => open(goLinkUrl(ctx.goBaseUrl, block.goSlug, ctx.articleSlug))} />
          {block.note ? <Text style={[styles.small, styles.center, { color: c.muted }]}>{block.note}</Text> : null}
        </View>
      );
    case "callout": {
      const tone = block.tone === "warning" ? c.warning : block.tone === "tip" ? c.success : c.brand;
      return (
        <View style={[styles.callout, { borderLeftColor: tone, backgroundColor: c.surface }]}>
          <Rich inlines={block.children} ctx={ctx} numbers={numbers} />
        </View>
      );
    }
    case "sources":
      return <SourceList ctx={ctx} numbers={numbers} />;
  }
}

function Bullets({ title, items, tone, mark = "•" }: { title: string; items: string[]; tone: string; mark?: string }) {
  const c = usePalette();
  if (items.length === 0) return null;
  return (
    <View style={styles.bullets}>
      <Text style={[styles.bold, { color: c.text }]}>{title}</Text>
      {items.map((item, i) => (
        <View key={i} style={styles.listItem}>
          <Text style={[styles.body, styles.bold, { color: tone }]}>{mark}</Text>
          <Text style={[styles.body, styles.flex, { color: c.text }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function FaqItem({ question, children }: { question: string; children: React.ReactNode }) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.faq, { borderColor: c.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={styles.row}
      >
        <Text style={[styles.bold, styles.flex, { color: c.text }]}>{question}</Text>
        <Text style={{ color: c.muted }}>{open ? "−" : "+"}</Text>
      </Pressable>
      {open ? <View style={styles.faqAnswer}>{children}</View> : null}
    </View>
  );
}

function ComparisonTable({ block, ctx }: { block: Extract<Block, { type: "comparison_table" }>; ctx: BlockContext }) {
  const c = usePalette();
  const headers = comparisonHeaders(block.productIds, ctx.products ?? []);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={[styles.table, { borderColor: c.border }]}>
        <View style={[styles.tableRow, { backgroundColor: c.surface }]}>
          <Text style={[styles.cell, styles.labelCell, styles.bold, { color: c.text }]} />
          {headers.map((h, i) => (
            <Text key={i} style={[styles.cell, styles.bold, { color: c.text }]}>
              {h}
            </Text>
          ))}
        </View>
        {block.rows.map((row, r) => (
          <View key={r} style={[styles.tableRow, { borderColor: c.border }]}>
            <Text style={[styles.cell, styles.labelCell, styles.bold, { color: c.text }]}>{row.label}</Text>
            {row.values.map((v, i) => (
              <Text key={i} style={[styles.cell, { color: c.text }]}>
                {v}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function SourceList({ ctx, numbers }: { ctx: BlockContext; numbers: Map<string, number> }) {
  const c = usePalette();
  const { t } = useApp();
  if (ctx.sources.length === 0) return null;
  const ordered = [...ctx.sources].sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0));
  return (
    <View style={styles.list}>
      <Text style={[styles.h3, { color: c.text }]}>{t("review.sources")}</Text>
      {ordered.map((s) => (
        <Text
          key={s.id}
          style={[styles.small, { color: c.brand }]}
          onPress={() => open(s.url)}
          accessibilityRole="link"
        >
          {numbers.get(s.id)}. {s.title || new URL(s.url).hostname}
        </Text>
      ))}
    </View>
  );
}

/** Plain text of a block, for share sheets and accessibility summaries. */
export const blockText = (block: Block) => (block.type === "paragraph" ? inlineText(block.children) : "");

const styles = StyleSheet.create({
  blocks: { gap: SPACE.lg },
  body: { fontSize: 17, lineHeight: 26 },
  small: { fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  code: { fontFamily: "Menlo", fontSize: 15 },
  citation: { fontSize: 13 },
  h2: { fontSize: 22, fontWeight: "700", marginTop: SPACE.md },
  h3: { fontSize: 18, fontWeight: "700" },
  list: { gap: SPACE.sm },
  listItem: { flexDirection: "row", gap: SPACE.sm, alignItems: "flex-start" },
  bullets: { gap: SPACE.xs, marginTop: SPACE.sm },
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  center: { textAlign: "center" },
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: SPACE.lg, gap: SPACE.sm },
  price: { fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] },
  rubricRow: { gap: SPACE.xs, paddingBottom: SPACE.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6 },
  image: { width: "100%", borderRadius: 10 },
  faq: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: SPACE.md },
  faqAnswer: { marginTop: SPACE.sm },
  callout: { borderLeftWidth: 4, borderRadius: 8, padding: SPACE.md },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
  tableRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  cell: { width: 140, padding: SPACE.sm, fontSize: 14 },
  labelCell: { width: 120 },
});
