import { createLlm, LlmTruncatedError, MODELS } from "@repo/ai";
import { seoBriefSchema } from "@repo/content";
import type { z } from "zod";
import { articleDraftSchema } from "../src/article-builder";
import { fixSchema, verdictSchema } from "../src/fact-check-core";
import { sectionSchema } from "../src/section";
import { classificationSchema } from "../src/sourcing/classify";
import { programDraftSchema } from "../src/steps/affiliate-discovery";
import { competitorDraftSchema } from "../src/steps/competitors";
import { derivativeDraftSchema } from "../src/steps/derivatives";
import { sourceExtractionSchema } from "../src/steps/extract-facts";
import { factSheetDraftSchema } from "../src/steps/fact-sheet";
import { resolvedSchema } from "../src/steps/resolve-product";
import { socialDraftSchema } from "../src/steps/social";
import { styleSchema } from "../src/steps/style-pass";
import { videoScriptDraftSchema } from "../src/video/script";

/**
 * Sends each model-facing schema with a tiny prompt so the API compiles its grammar. Catches
 * "grammar too large" and unsupported-schema errors before a real run. Costs a fraction of a cent.
 *   pnpm --filter @repo/pipeline check-schemas
 */
const llm = createLlm();
const schemas: Array<[string, z.ZodType, string]> = [
  ["resolve_product", resolvedSchema, MODELS.haiku],
  ["extract_facts", sourceExtractionSchema, MODELS.haiku],
  ["fact_sheet", factSheetDraftSchema, MODELS.opus],
  ["affiliate_discovery", programDraftSchema, MODELS.sonnet],
  ["competitors", competitorDraftSchema, MODELS.sonnet],
  ["seo_brief", seoBriefSchema, MODELS.opus],
  ["write", articleDraftSchema, MODELS.opus],
  ["fact_check", verdictSchema, MODELS.opus],
  ["fact_fix", fixSchema, MODELS.opus],
  ["style_pass", styleSchema, MODELS.sonnet],
  ["section_regenerate", sectionSchema, MODELS.opus],
  ["product_sourcing", classificationSchema, MODELS.haiku],
  ["video_script", videoScriptDraftSchema, MODELS.sonnet],
  ["derivative_write", derivativeDraftSchema, MODELS.opus],
  ["social", socialDraftSchema, MODELS.sonnet],
];
let failed = 0;
for (const [name, schema, model] of schemas) {
  try {
    await llm.generateStructured({
      model,
      effort: "low",
      prompt: "Return a minimal valid example.",
      maxTokens: 300,
      schema,
      operation: "schema_check",
    });
    console.log(`ok    ${name}`);
  } catch (error) {
    if (error instanceof LlmTruncatedError || /LlmParseError|Failed to parse structured output/.test(String(error)))
      console.log(`ok    ${name} (compiled, output cut short)`);
    else {
      failed++;
      console.log(`FAIL  ${name}: ${String(error).slice(0, 300)}`);
    }
  }
}
process.exit(failed ? 1 : 0);
