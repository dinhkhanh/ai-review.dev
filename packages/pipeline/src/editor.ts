/**
 * Pipeline helpers for the CMS (FR-CMS-3/5, FR-QA-3). Kept free of research/graphics imports so the
 * CMS bundle never loads native image libraries.
 */
export { pricingTableFromFactSheet, SECTION_KEYS, type SectionKey } from "./article-builder";
export {
  applyLines,
  blockToLines,
  citationSignature,
  isEditable,
  type EditableBlock,
  type RefMap,
} from "./article-lines";
export { PROMPT_KEYS, PROMPTS, resolvePrompt, type PromptKey, type PromptDefinition } from "./prompts";
export { computeQaScorecard, findBannedPhrases } from "./qa";
export {
  DERIVATIVE_STEPS,
  prepareRerun,
  REVIEW_STEPS,
  stepsForPreset,
  TRANSLATE_STEPS,
  type DerivativeStep,
  type ReviewStep,
  type TranslateStep,
} from "./review-steps";
export { regenerateSection, sectionKeyOf } from "./section";
export { recheckBlocks } from "./section-check";
export type { StepServices } from "./step";
export { generateSocialSnippets } from "./steps/social";
