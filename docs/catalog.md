# Catalog maintenance

The extension ships `data/catalog.json` and accepts a versioned JSON contract from its published feed and user-added catalogs. Runtime validation is in `src/core.ts`; TypeScript records are in `src/types.ts`. Validate a file with `npm run catalog:check -- path/to/catalog.json`. Keep each UTF-8 payload below 2 MB. User-added catalogs append locally; see [extra catalogs](extra-catalogs.md).

Revision format is `YYYY-MM-DD.N`, where `N` is a positive sequence from 1 to 9999999 with no leading zeros. Schema 1 uses `reviewedAt` as the revision date. Schema 2 allows a separate `syncedAt`; the revision date equals `syncedAt` when present, otherwise `reviewedAt`. Increase the sequence for same-day changes. Clients compare revision dates and numeric sequences, so older same-day data cannot override a correction. Automatic synchronization never advances the human `reviewedAt` date. Schema 2 prices likewise distinguish `syncedAt` from an optional actual `reviewedAt`.

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

## Automatic synchronization and publication

The **Sync and publish catalog** workflow runs daily at 06:23 UTC, on relevant catalog/importer changes pushed to `main`, and through **Run workflow**. GitHub Pages must be enabled once with **GitHub Actions** as its publishing source. No extra API key or custom repository secret is needed. GitHub can delay scheduled jobs; this is a daily check, not a real-time feed.

`npm run catalog:sync` resolves `github/docs`'s current `main` commit once and downloads all source files from that exact SHA. The importer uses GitHub's release, plan, client, retirement, and pricing YAML tables, the documented extended-capability table, the supporting restrictions and pricing footnotes, and official display-name variables. It writes `artifacts/site/catalog/v2.json`; it does not overwrite the human-maintained `data/catalog.json` or commit generated data to the repository.

- Names, providers, release status, plan/client availability, supported extended capabilities, token rates, cache rates, pricing thresholds, and recognized promotion expiry are synchronized. The displayed facts retain links pinned to the upstream SHA and CC BY 4.0 attribution.
- Restriction footnotes are preserved, including annual-plan exceptions and Fable's data-retention/access conditions. Copilot Chat exclusions such as the Codex-only GPT-5.4 nano are excluded, as are models explicitly unsupported in VS Code or absent from the current release table. Missing plan/client rows are shown as unknown; for example, the pinned October 18 source lacks a GPT-6.1 Sol client row.
- Existing aliases, task guidance, editorial order, and the source links supporting that guidance stay curated. New models have no guessed runtime aliases or task recommendations. They appear in the public catalog, but automatic matching to a discovered runtime model requires a reviewed alias. Capabilities describe GitHub's advertised options, not the current runtime input limit.
- Promotions are accepted only when their documented rates, pricing table, units, and supported end-date wording agree. “Until” dates are treated conservatively as ending before that date. Missing prices become unavailable; expired promotional prices remain hidden by the extension. Unrecognized pricing conditions, fields, table structures, or restriction templates abort publication for a maintainer to review.

The workflow loads the previously deployed `/catalog/v2.json` before generating a new feed. Same-day retries retain the revision when the content is unchanged; changed content increments the highest published or bundled sequence. Future-dated feeds, invalid data, and failures downloading the prior feed abort the run. Only HTTP 404 permits initial publication without a previous feed. Validation completes before deployment, so a failed synchronization leaves the previous GitHub Pages deployment intact.

The deployed site contains the automatic **`/catalog/v2.json`** plus the unchanged bundled **`/catalog/v1.json`** for older clients, licenses, and third-party notices. Release builds use the v2 feed; local builds remain offline unless a feed URL is configured. The workflow reads the actual Pages base URL, including a configured custom domain, when checking the previous revision. Keep the extension's `LLMBENCH_CATALOG_URL` override aligned if hosting changes; see the [development guide](development.md).

To run a synchronization locally against a previous feed:

```sh
npm run catalog:sync -- artifacts/site/catalog/v2.json https://mebaysan.github.io/modelbeacon/catalog/v2.json
npm run catalog:check -- artifacts/site/catalog/v2.json
```

Omit the URL only for a local preview, not when replacing an existing published feed. The importer tests use pinned offline GitHub fixtures and cover unknown formats, promotions, missing data, retirements, and revision ordering. No LLM inference, Terminal-Bench collection, or organization data enters this pipeline.

## Manual review workflow

1. Review GitHub's model listings, aliases, support restrictions, capabilities, task advice, and current prices against the pinned catalog sources. Check source licensing when changing sources.
2. Edit approved facts and source records in `data/catalog.json`. Increment `revision` and set `reviewedAt` only after completing the review. Update pricing review dates only when rates were checked.
3. Run `npm run catalog:check` and the project tests. Inspect changed model cards and comparison tables, then review the diff.
4. Push the reviewed catalog to `main` to synchronize and publish it, or run **Sync and publish catalog** manually. Publish a new extension version when changing the bundled fallback. If source verification fails, retain the previous valid catalog.

The extension distinguishes synchronization freshness from human review age and preserves its last valid catalog on network or schema failures. Automatic synchronization does not re-review guidance or establish exact deployed model equivalence.

## Licensing and launch limitations

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and `data/licenses/`. The extension's MIT license does not replace source data licenses. No third-party benchmark dataset is bundled; new evidence must not be imported under an assumed redistribution permission.

The catalog is a reviewable public-data snapshot. Signed-in discovery, exact deployed model equivalence, and user demand cannot be established by these source files. Refresh the evidence and validate real runtime aliases before claiming those properties.
