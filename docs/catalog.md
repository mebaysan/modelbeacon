# Catalog maintenance

The extension ships `data/catalog.json` and accepts the same versioned JSON contract from an optional published feed. Runtime validation is in `src/core.ts`; TypeScript records are in `src/types.ts`. Validate with `npm run catalog:check`. Keep the UTF-8 payload below 2 MB.

Revision format is `YYYY-MM-DD.N`: the date must equal `reviewedAt`, and `N` is a positive sequence from 1 to 9999999 with no leading zeros. Increase the sequence for same-day corrections; reset it to 1 on a new review date. Clients compare dates and numeric sequences, so an older same-day cache or feed cannot override a corrected bundled catalog.

Catalog revision **2026-10-17.2** contains **31 models, seven pinned source links, and no benchmark observations**. Its model facts, guidance, and pricing were reviewed on October 17, 2026. GPT-5.4 nano is omitted because GitHub lists it for the Codex extension rather than Copilot Chat. Sonnet 4.6 remains listed with its annual-plan restriction. Public listing does not establish a user's subscription access or exact picker contents.

## Source and interpretation rules

The catalog uses GitHub's Copilot documentation and checked-in YAML tables at `github/docs@dae83f7d28f3b8e10015bd6b6d8b72267cedceca`. CC BY 4.0 attribution is retained. These are bundled facts: browsing them does not require contacting the source repository. ModelBeacon still relies on external documentation for public model claims and prices.

- Every displayed fact, recommendation, and rate table references a source. Source links point to immutable commits. `retrievedAt` is the retrieval date and `reviewedAt` is the human review date.
- Guidance is this project's interpretation and paraphrase of GitHub's task guidance, not an independent test or guarantee. Catalog order determines editorial shortlist preference: filter eligible models, take the first three, then display those choices alphabetically. Review array order as well as wording; alphabetical display does not determine which models enter the shortlist.
- Model IDs and aliases are explicit, case-sensitive name-level mappings. These have not all been verified against a signed-in Copilot runtime. Do not claim matching deployed snapshots, infer aliases from substrings at runtime, or silently map an unknown model to a related model.
- Prices are GitHub Copilot USD rates per million tokens, including separate cache input/write rates and documented long-context tiers. They are not account usage or a bill estimate. Legacy annual request-based plans have separate rules. Gemini Flash promotions run through December 31, 2026; Argon's promotion is described as ending December 1, so `validThrough` is conservatively November 30. Hide expired prices until reviewed replacements exist.
- Advertised optional 1M context is a sourced capability, not the API's current `maxInputTokens`. Do not merge these values.
- Preserve material source limitations: Sonnet 4.6 annual-plan access, Fable data-retention/access conditions, Kimi safeguards, and MAI checkpoint changes. Put restrictions that affect shortlist use directly in guidance limitations too. Sonnet 4.6's visual and everyday recommendations identify eligible annual Pro/Pro+ subscriptions; Fable recommendations identify Copilot Pro exclusion and the retention/access conditions whose supporting links are in model facts.

## Benchmark evidence

The bundled catalog's `benchmarks` array is empty. ModelBeacon has no direct Terminal-Bench importer, bundled benchmark dataset, scheduled benchmark collection, or inference-based evaluation. It does not assign scores from task guidance or model names.

The generic catalog schema and chart renderer still accept sourced observations, preserving the existing contract for reviewed feeds. If observations are ever added, each needs its source, evaluation context, dates, and licensing review. Catalog charts require explicitly reviewed compatible configurations; missing observations must remain unknown. Do not combine unrelated results into a winner score or imply that an external evaluation measures a user's Copilot session.

### Optional OpenRouter snapshots

The published-score feature downloads public evaluations from OpenRouter when the user connects, adds models to a comparison, chooses **View comparison** or **Show score charts**, or requests a refresh. Link/change reference controls also download scores if no snapshot is cached. Data is stored separately from `data/catalog.json`. These scores and the user's explicit reference-model links belong in local extension storage, never in the repository or reviewed catalog. References resolve locally from exact IDs or unique normalized names, with explicit saved overrides taking precedence. Ambiguous candidates remain unavailable; automatic resolutions are not written into the catalog or saved as user choices. A reference can be attached to a custom model but does not establish equivalence to its deployed version or transfer Copilot prices and claims.

The default metrics are GPQA Diamond and τ-bench Verified Airline. Artificial Analysis intelligence, coding, and agentic indices are optional because their composite methodology can include Terminal-Bench. `llmBench.includeCompositeScores` defaults to `false`; after changing the setting, choose **Show score charts** or **Refresh scores** to obtain newly enabled data. The setting change itself does not fetch scores. No source records are fetched directly from Terminal-Bench.

Keep the API source attribution, `as_of` date, metric identity, and units attached to scores. Each chart compares only the same reported metric in the downloaded snapshot. The API does not establish that every model used the same evaluation configuration. Charts do not assert statistical significance; reported standard deviations must not be presented as confidence intervals. Preserve missing values as unavailable and reject invalid responses without discarding the last valid snapshot.

The aggregate API data's attribution and licensing are documented in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Refreshing public scores is independent of the GitHub catalog's human review and revision sequence.

Documentation screenshots use fictional models and synthetic scores to demonstrate charts. Keep those fixtures separate from production catalog data and downloaded score caches, and visibly label them as illustrative sample data. A screenshot refresh does not constitute a model evaluation or a catalog review.

## Manual review workflow

1. Review GitHub's model listings, aliases, support restrictions, capabilities, task advice, and current prices against the pinned catalog sources. Check source licensing when changing sources.
2. Edit approved facts and source records in `data/catalog.json`. Increment `revision` and set `reviewedAt` only after completing the review. Update pricing review dates only when rates were checked.
3. Run `npm run catalog:check` and the project tests. Inspect changed model cards and comparison tables, then review the diff.
4. Release the updated extension or publish the reviewed catalog through the existing publishing workflow. If source verification fails, retain the previous valid catalog.

There is no scheduled upstream import. The extension marks the catalog stale after 14 days without review and preserves its last valid catalog on network or schema failures. Local builds have no catalog endpoint by default; feed configuration is described in the [development guide](development.md).

## Licensing and launch limitations

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and `data/licenses/`. The extension's MIT license does not replace source data licenses. No third-party benchmark dataset is bundled; new evidence must not be imported under an assumed redistribution permission.

The catalog is a reviewable public-data snapshot. Signed-in discovery, exact deployed model equivalence, and user demand cannot be established by these source files. Refresh the evidence and validate real runtime aliases before claiming those properties.
