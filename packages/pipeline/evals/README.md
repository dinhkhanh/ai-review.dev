# Prompt evals

Golden-set evals for the pipeline prompts (docs/plan.md §5 "Evals"). Use them before activating a
prompt edit: run the suite with `--compare both` and keep the change only if scores hold or improve.

```sh
# 1. Export research for a product the pipeline has already researched (reads DATABASE_URL only)
pnpm --filter @repo/pipeline eval:snapshot -- plausible-analytics

# 2. Run a suite (repo prompts by default)
pnpm --filter @repo/pipeline eval -- --suite fact_sheet
pnpm --filter @repo/pipeline eval -- --suite write --cases plausible-analytics [--no-judge]
pnpm --filter @repo/pipeline eval -- --suite fact_check [--errors 6]

# 3. Hill-climb: repo default vs the CMS's active override (and per-step model settings)
pnpm --filter @repo/pipeline eval -- --suite fact_check --compare both
```

Results print as a table and are saved as an `eval_runs` row in the main database, shown in the
CMS under Settings → Prompt evals (`/settings/evals`).

## How it works

- **Golden set** (`golden.json`): 10 products with expectations taken from public pricing pages,
  each with its source URL and check date. Expectations cover tier names, prices (with a tolerance
  where monthly and yearly-billed prices differ), free plan, trial days, must-mention features and
  a rubric sanity band. A case with `snapshot: null` is skipped until it has been researched.
- **Snapshots** (`snapshots/<slug>.json`, gitignored): sources (clipped to 24k characters, what the
  prompts read), chunks, fact sheet, SEO brief, current article and competitors. They contain
  third-party page text, so they stay local rather than in git; re-export after a fresh crawl.
- **Isolated database**: each case is loaded into `<DATABASE_URL db>_eval_pipeline` (or
  `EVAL_DATABASE_URL`, required when DATABASE_URL is not local) and the **real steps** run there,
  so prompts, schemas and retrieval are exactly production's. Embeddings are skipped: retrieval
  uses the full-text fallback, which is deterministic and free. Editorial settings are copied
  from the main database in both modes; prompt overrides and step models only with `--compare db`.

## Suites

| Suite        | Runs                                                   | Graded by                                                                                                                                                      |
| ------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fact_sheet` | `extract_facts` + `fact_sheet` steps                   | tier recall, price accuracy, free plan/trial, feature recall, pricing citation coverage                                                                        |
| `write`      | `write` step on the snapshot fact sheet and brief      | review contract (verdict, rubric dims, pricing table, pros/cons, FAQ, CTAs, H2s), words, citations resolve, banned phrases, score band; plus a Haiku LLM judge |
| `fact_check` | claim verification (`fact_check` prompt with evidence) | wrong figures seeded into cited sentences: recall (seeded caught) and precision (lower bound: control claims flagged may be real problems)                     |

The judge rubric is fixed (`judge.ts`, `JUDGE_VERSION`); bump the version when changing it, since
scores are only comparable within one judge version.
