import {
  costSink,
  addArticleVersion,
  getArticle,
  getCurrentVersion,
  listSources,
  searchChunks,
  sourceRefs,
} from "@repo/core";
import type { Embedder, Llm } from "@repo/ai";
import type { Block } from "@repo/content";
import type { DbOrTx } from "@repo/db";
import { z } from "zod";
import { SECTION_KEYS, sectionBlocks, type SectionKey } from "./article-builder";
import { blockToLines, isEditable } from "./article-lines";
import { resolvePrompt, type ResolvedPrompt } from "./prompts";
import type { StepServices } from "./step";

export const sectionSchema = z.object({
  heading: z.string(),
  paragraphs: z.array(z.string()),
  bullets: z.array(z.string()),
});

export function sectionKeyOf(blockId: string): SectionKey | null {
  const m = /^sec-([a-z_]+)-/.exec(blockId);
  return m && (SECTION_KEYS as readonly string[]).includes(m[1]!) ? (m[1] as SectionKey) : null;
}

export interface SectionRewriteDeps {
  db: DbOrTx;
  llm: Llm;
  embedder: Embedder | null;
  prompt: ResolvedPrompt;
}

/**
 * Rewrites the prose blocks of one review section (heading, paragraphs, list) from fresh research
 * excerpts, keeping deterministic blocks (pricing table, screenshots, comparison, CTAs) in place.
 * Returns the new block list; callers save it as a version. Used by the editor's "regenerate
 * section" (FR-CON-2, FR-QA-3) and by refreshes (FR-MNT-1).
 */
export async function rewriteSectionBlocks(
  deps: SectionRewriteDeps,
  input: { articleTitle: string; productId: string; blocks: Block[]; section: SectionKey; instruction: string },
): Promise<Block[]> {
  const prefix = `sec-${input.section}-`;
  const current = input.blocks.filter((b) => b.id.startsWith(prefix));
  if (current.length === 0) throw new Error(`Section ${input.section} not found in this article`);

  const sources = await listSources(deps.db, input.productId);
  const refs = sourceRefs(sources);
  const text = current.flatMap((b) => (isEditable(b) ? blockToLines(b, refs) : b.type === "heading" ? [b.text] : []));
  const query = `${input.section.replace("_", " ")} ${input.instruction} ${text.join(" ")}`.slice(0, 1000);
  const [vector] = deps.embedder
    ? await deps.embedder.embed([query], { inputType: "query" }).catch(() => [null])
    : [null];
  const chunks = await searchChunks(deps.db, input.productId, { query, embedding: vector ?? null, limit: 10 });

  const res = await deps.llm.generateStructured({
    model: deps.prompt.model,
    effort: deps.prompt.effort,
    system: deps.prompt.system,
    operation: "section_regenerate",
    maxTokens: 16_000,
    schema: sectionSchema,
    prompt: [
      `Article: ${input.articleTitle}`,
      `Section: ${input.section}`,
      `Editor's instruction: ${input.instruction}`,
      `Current section text:\n${text.join("\n")}`,
      `Sources (ref | title | url):\n${sources.map((s) => `${refs.ref(s.id)} | ${s.title ?? ""} | ${s.url}`).join("\n")}`,
      `Research excerpts:\n${chunks.map((c) => `<excerpt source="${refs.ref(c.sourceId)}">\n${c.text}\n</excerpt>`).join("\n")}`,
    ].join("\n\n"),
  });

  const fresh = sectionBlocks({ key: input.section, ...res.data }, refs.id);
  const isProse = (b: Block) => b.id.startsWith(prefix);
  const firstIndex = input.blocks.findIndex(isProse);
  // Replace prose blocks of the section; keep non-prose blocks that sat between them.
  const kept = input.blocks.filter((b) => !isProse(b));
  const heading = fresh[0]!;
  const body = fresh.slice(1);
  const blocks = [...kept.slice(0, firstIndex), heading, ...body, ...kept.slice(firstIndex)];
  // Deterministic blocks that followed the old heading (e.g. pricing table) stay right after the heading.
  if (input.section === "pricing") {
    const tableAt = blocks.findIndex((b) => b.type === "pricing_table");
    if (tableAt > -1) {
      const [table] = blocks.splice(tableAt, 1);
      blocks.splice(blocks.indexOf(heading) + 1, 0, table!);
    }
  }
  return blocks;
}

/** "Regenerate this section with instruction" from the editor; costs are ledgered without a job. */
export async function regenerateSection(
  services: StepServices,
  input: { articleId: string; section: SectionKey; instruction: string; userId?: string | null },
) {
  const article = await getArticle(services.db, input.articleId);
  const version = await getCurrentVersion(services.db, input.articleId);
  if (!article?.productId || !version) throw new Error("Article or version not found");
  let cost = 0;
  const sink = costSink(services.db, {});
  const tracked = (event: Parameters<typeof sink>[0]) => {
    cost += event.costUsd;
    return sink(event);
  };
  const prompt = await resolvePrompt(services.db, "section_regenerate");
  const blocks = await rewriteSectionBlocks(
    { db: services.db, llm: services.makeLlm(tracked), embedder: services.makeEmbedder?.(tracked) ?? null, prompt },
    {
      articleTitle: article.title,
      productId: article.productId,
      blocks: version.blocks,
      section: input.section,
      instruction: input.instruction,
    },
  );
  const saved = await addArticleVersion(services.db, article.id, {
    blocks,
    seo: version.seo,
    overallScore: version.overallScore,
    promptVersions: { ...version.promptVersions, section_regenerate: prompt.version },
    userId: input.userId ?? null,
    changeNote: `Regenerated section "${input.section}": ${input.instruction.slice(0, 120)}`,
  });
  return { version: saved, cost };
}
