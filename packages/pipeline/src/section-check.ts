import { extractClaims, type FactCheckReport } from "@repo/content";
import {
  articleProductIds,
  costSink,
  getArticle,
  getVersion,
  listSourcesForProducts,
  setVersionQa,
  sourceRefs,
} from "@repo/core";
import { buildReport, gatherEvidence, toChecked, verifyClaims } from "./fact-check-core";
import { computeQaScorecard } from "./qa";
import type { StepServices } from "./step";

/**
 * Fact-checks the given blocks of a version and merges the result into its report, then refreshes
 * the QA scorecard (used after a section is regenerated in the CMS, FR-CON-5).
 */
export async function recheckBlocks(services: StepServices, articleId: string, versionId: string, blockIds: string[]) {
  const article = await getArticle(services.db, articleId);
  const version = await getVersion(services.db, versionId);
  const productIds = article ? articleProductIds(article) : [];
  if (!article || !productIds.length || !version) throw new Error("Article or version not found");
  const refs = sourceRefs(await listSourcesForProducts(services.db, productIds));
  const sink = costSink(services.db, {});
  const deps = { db: services.db, llm: services.makeLlm(sink), embedder: services.makeEmbedder?.(sink) ?? null };
  const claims = extractClaims(version.blocks.filter((b) => blockIds.includes(b.id)));
  const evidence = await gatherEvidence(deps, productIds, claims);
  const verdicts = await verifyClaims(deps, claims, evidence, refs);
  const previous: FactCheckReport["claims"] = (version.factCheck?.claims ?? []).filter(
    (c) => !blockIds.includes(c.blockId),
  );
  const factCheck = buildReport([...previous, ...toChecked(claims, verdicts, refs)]);
  await setVersionQa(services.db, version.id, { factCheck });
  const qaScorecard = await computeQaScorecard(services.db, articleId, version.id);
  await setVersionQa(services.db, version.id, { qaScorecard });
  return { factCheck, qaScorecard };
}
