# Prompts

Versioned prompt templates (constraint C-5). One folder per step, one file per version:

```
prompts/
  fact_sheet/v1.md
  write/v1.md
```

Each file starts with front-matter:

```yaml
---
model: claude-opus-5-5
effort: high
output: factSheetSchema # name of the Zod schema in @repo/content, for structured steps
---
```

Rules:

- Never edit a published version in place. Copy to `vN+1.md`, change, and run the evals.
- The version string (`fact_sheet@v1`) is recorded on every artefact the prompt produces.
- The CMS prompt editor stores drafts in the `prompt_templates` table; promoting a draft writes a new file in a PR.
- Keep the stable part (instructions, style guide, rubric) first so it is cached; put per-product data last.

The loader and the first prompts arrive with the Phase 1 research and writing steps.
