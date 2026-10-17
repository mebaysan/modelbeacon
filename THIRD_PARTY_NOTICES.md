# Third-party data notices

Extension source code is licensed under MIT. The following notices apply separately to bundled catalog data and optional downloaded public scores. This project is independent of GitHub, Microsoft, OpenRouter, Artificial Analysis, OpenAI, Anthropic, and Google; attribution does not imply endorsement.

## GitHub documentation — CC BY 4.0

Copyright GitHub, Inc. and contributors. Model listings, capability descriptions, task guidance, and Copilot rates are adapted from [GitHub Docs](https://github.com/github/docs), revision `dae83f7d28f3b8e10015bd6b6d8b72267cedceca`, retrieved October 17, 2026.

Sources are the supported-models, model-comparison, and models-and-pricing reference articles, plus their model-release-status, model-supported-plans, model-comparison, and models-and-pricing YAML tables. Every catalog source includes a pinned link and license link. Changes made here: selected and normalized records, paraphrased descriptions, assigned task categories, added editorial limitations and ordering, converted monetary fields into numbers, and recorded promotion expiry.

Licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). The upstream license text is retained in `data/licenses/github-docs-CC-BY-4.0.txt`. These adaptations have not been reviewed or endorsed by GitHub.

## OpenRouter Data API — CC BY 4.0

Published scores are fetched on request from the [OpenRouter benchmarks API](https://openrouter.ai/docs/api/api-reference/benchmarks/list-benchmarks), using the user's API key. No live score dataset is bundled in the extension. OpenRouter's [Data API licensing guidance](https://openrouter.ai/docs/cookbook/administration/data-api) licenses the aggregate data returned by these endpoints under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The interface preserves the source attribution and API snapshot date alongside displayed scores. Attribution identifies OpenRouter evaluations, or Artificial Analysis via OpenRouter for the optional composite indices. Changes made here: selected supported metrics and fields, validated and cached records locally, associated user-selected reference models, formatted numeric values and units, and visualized results. Missing scores are not generated or estimated.

GPQA Diamond and τ-bench Verified Airline are individual evaluations. Optional Artificial Analysis composite indices use that provider's methodology, which can incorporate Terminal-Bench. ModelBeacon does not import Terminal-Bench records or bundle its dataset. See the [Artificial Analysis methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking) before interpreting those indices.

Downloaded source attribution and dates must remain attached if score data is redistributed. The aggregate-data license does not grant rights to unrelated databases, benchmark task contents, provider branding, or private account data.

## Other sources

No live benchmark score dataset is bundled. The README's score-chart screenshots use fictional Example Model A, B, and C with original synthetic values to illustrate the interface. Those values are not OpenRouter or Artificial Analysis measurements, even where the UI shows the source labels used by the feature. These sample fixtures are not available as production model results.

External documentation links do not confer permission to copy a site's database or imply a partnership. Any additional data source requires a separately documented source and license review.
