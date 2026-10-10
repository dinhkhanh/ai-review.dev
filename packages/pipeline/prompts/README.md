# Prompts

Versioned prompts (constraint C-5) live in `src/prompts/index.ts` as TypeScript, so every runtime
(worker bundle, CMS, tests) gets them without file loading. Each entry has a `key`, `version`,
default `model` and `effort`, and the `system` text. The version string (`write@v1`) is recorded
on each step and article version (`promptVersions`).

Rules:

- Never edit a released version in place. Change the text, bump `version`, and run a job on a
  known product to compare. (Golden-set evals arrive in Phase 2.)
- Keep stable instructions in `system` (cached); per-product data goes in the user message.
- `{{STYLE_GUIDE}}` is filled from the `editorial.styleGuide` setting (or the repo default) plus
  `editorial.bannedPhrases`.
- Model-facing output schemas must stay small and flat: deeply nested schemas exceed the
  structured-output grammar limit. Run `pnpm --filter @repo/pipeline check-schemas` (a few
  cents) after changing any schema.

CMS overrides: Settings → Prompts saves a new body as version 1001+ in `prompt_templates` and can
activate it or revert to the repo default. Per-step model/effort overrides live in the
`pipeline.stepModels` setting. Promote a good override back into the repo as the next version.
