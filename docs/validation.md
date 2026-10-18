# Release validation

Automated tests establish implementation behavior. They do not establish account entitlement parity, actual Copilot performance, or product demand.

## Automated

- `npm run check`: TypeScript checks for the extension, shared logic, webview, scripts, and tests.
- `npm test`: catalog validation, identity matching, guidance filtering, benchmark compatibility, pricing expiry, cache/update failures, size limits, and refresh concurrency. Local-model checks cover metadata allowlisting, restart without discovery, vendor/version separation, and clearing during pending discovery or storage writes. Published-score checks use fixtures to verify response validation, metric policy, automatic resolution and manual overrides, cache preservation, and credential handling without authenticated API calls.
- `npm run catalog:check`: production catalog structure and references. The bundled catalog contains no benchmark observations.
- `npm run test:ui`: desktop and narrow Chromium interactions, keyboard tabs, search persistence, comparison limits, generic matching/mismatched benchmark layouts using test fixtures, unavailable data, unsafe text, and viewport containment. Custom-model checks cover mixed comparisons, evidence isolation, offline labels, and clearing persisted selections. Published-score fixtures exercise comparison/detail charts, reference actions, and the default exclusion of composite indices.
- `npm run test:extension`: activation, command registration, singleton editor behavior, and close/reopen in an isolated real VS Code instance.
- `npm run package`: prepublish checks and installable VSIX packaging.

CI runs checks and packaging on Windows, macOS, and Linux. Browser and native extension-host tests run on Linux. A configured workflow is not evidence that it has run successfully on GitHub yet.

## Local comparison verification — October 18, 2026

On macOS, native VS Code testing used an isolated profile with the existing ModelBeacon connection and references. The normal workspace and saved state were not modified by these checks.

- Installed 0.4.2, with an empty test score cache: Add to compare and View comparison made no download and displayed no charts.
- Fixed 0.4.3, under the same conditions: the comparison downloaded 312 published scores through the saved OpenRouter connection and displayed both default metric charts. A second run compared two linked models without a reference prompt, Show score charts, or Refresh.
- Fixed 0.4.4, with both the test score cache and manual references empty: Compare downloaded 312 scores, resolved two model references automatically, and rendered both chart types without a model-name picker.
- The final automated suites passed 101 unit/host tests and 93 browser tests. These checks do not establish coverage for every provider, model, metric, or organization deployment.

## Marketplace workflow checks

- `marketplace-publish.yml` runs only for stable published GitHub Releases in this repository. Verify the tag equals `v` plus the package version and both lockfile version fields agree.
- Keep credentials scoped to the publish step as repository secrets. Publish the already-tested VSIX with Entra authentication; never inject publisher credentials into the extension or its artifacts.
- Validate workflow syntax with actionlint and exercise the inline release validator with matching and mismatching versions before changing release rules. Both release workflows passed actionlint 1.7.7, and the tag/identity/lockfile validator passed nine positive/negative cases locally. Local workflow validation does not prove publisher authorization or a successful Marketplace release.

## Listing and media checks

- Keep the manifest description, README, feature labels, and screenshots consistent: score charts are optional, automatic references and manual overrides are labeled separately, and composite indexes are off by default.
- Inspect the home, comparison, and model-details screenshots at readable sizes. Score examples must use fictional model names and display a visible illustrative-data notice; README captions must also say the values are not measured model results. Never substitute fabricated values for a real model's results.
- Check the hero and packaged icon render without clipping, and preserve a legible monochrome Activity Bar icon.
- Verify every README image and documentation path exists. Inspect the packaged local VSIX's extension details page for readable feature and installation copy. Verify that all four README images and documentation links resolve to the public GitHub repository; release packages must pin them to the packaged commit.
- Confirm previews, tests, API keys, and account data are excluded from the VSIX. Do not describe the package as Marketplace-published or its score downloads as live-service-validated unless those steps have actually been completed.

## Account and environment checks before public release

Use a private beta VSIX. Record VS Code/Copilot version, account category (not identity), date, result, and discrepancies.

The scenarios below are release requirements, not a claim that all account and environment checks have been completed.

| Scenario | Expected behavior |
| --- | --- |
| Activity Bar / editor | ModelBeacon's icon opens the sidebar home view without launching an editor automatically. Open in Editor opens or reveals one dashboard. Both views receive updated discovery and cache state. |
| Home availability filter | Enabling Available models only triggers detection when needed, excludes cached-only models, and never falls back to public models on empty/error results. Custom models stay visible without invented guidance. Turning it off restores public browsing. |
| Earlier local build upgrade | Disable or uninstall the old extension first; the new `mebaysan.modelbeacon` identity starts with fresh local storage and no duplicated commands. |
| Signed out / no providers | Public catalog and saved model metadata remain usable; explicit detection gives a helpful empty/error state. |
| Other provider without Copilot | Explicit detection can list models exposed by that provider; the public catalog remains usable. |
| Paid individual | Explicit detection returns model metadata; compare IDs and names with visible picker and record discrepancies. |
| Free/Student / Auto-only | No claim that manual selection is available; public browsing remains usable. |
| Policy-managed account | Restricted or missing models are not guessed from plan names; changing policies refreshes discovery. |
| Newly released unknown model | Runtime identity remains visible with no fabricated benchmark or pricing. |
| Organization / BYOK / custom endpoint | Explicit detection lists the model if its provider exposes it through the stable API. Compare its metadata beside public models; unavailable evidence stays unknown. No endpoint configuration or inference request is needed. |
| Same model name across vendors | Distinct vendor identities remain separate; a custom model does not inherit public Copilot prices or unsupported claims. |
| Model version changes | Distinct versions remain identifiable, with their own last-seen metadata; a new version is not silently treated as the same public-model snapshot. |
| Restart or offline with saved models | Saved metadata reappears with last-seen labels, without implying current availability or triggering startup discovery. |
| Model-change event before detection | No automatic provider discovery occurs until explicit detection in this session. |
| Clear local models | Both the UI action and Command Palette command remove saved metadata, current discovery, and runtime-model score references. The public catalog, public-model references, score snapshot, and connection remain; restart stays clear until the next explicit detection. |
| Cache contents / remote workspace | The local model cache contains only allowlisted model metadata and last-seen timestamps, with no endpoint configurations, API keys, prompts, or responses. No model cache is written to the repository or registered for Settings Sync. |
| Remote SSH/WSL/container | Local UI extension opens; discovery is verified against the actual picker rather than assumed. |
| Restricted workspace | Browsing works; limited model availability is explained, not bypassed. |
| Model picker handoff | Copilot Chat opens and the picker is focused; fallback instructions appear if commands are unavailable. |
| Offline or blocked catalog host | Valid cached/bundled data remains visible; failed downloads do not erase it. |
| Score connection | Connect OpenRouter prompts in a native password input and downloads public scores. The key is absent from the webview, settings, logs, repository, and ordinary caches. |
| Score reference selection | Automatic references render without a picker for catalog and custom models. Explicit Link/Change controls open the picker and save a local override; Reset to automatic removes it. References never claim a verified deployed-model match. |
| Automatic comparison scores | With a saved key and an empty cache, Add to compare and View comparison fetch scores without Show score charts or Refresh. Scores resolve automatically without any model-name prompt. Missing or ambiguous matches stay unavailable, with an optional manual control. Rapid additions share the download. Removing or clearing selections does not fetch. |
| Show charts without a connection/cache | Show score charts is available on home and explore cards. It opens details, prompts for a key if needed, downloads scores once, and resolves references without asking for a model name. No separate Connect or Refresh click is required. |
| Downloaded scores with no references | Show score charts refreshes data and shows uniquely resolved charts automatically. Exact IDs and normalized names preserve version and reasoning distinctions; ambiguous IDs/names do not receive guessed scores. |
| Reopening linked charts | Each Show score charts click refreshes scores while retaining the saved reference. Cached charts stay visible during the request and on failure; the picker does not reopen. This works for catalog and custom models. |
| Reference controls without a cache | Link/change reference controls automatically download scores, prompting for a key if needed, before opening the picker. When scores are already cached, these controls use them without a refresh. |
| No background score downloads | Opening the extension, rendering charts, loading cached data, discovering models, and changing the composite setting make no score request. |
| Default score policy | GPQA Diamond and τ-bench Verified Airline can appear; Artificial Analysis composite indices remain excluded until explicitly enabled. Obtain newly enabled scores with Show score charts or Refresh scores; changing the setting alone does not download data. |
| Published comparison/detail charts | Values, units, labels, source links, and dates agree in both views. Missing scores are unavailable rather than zero. Any standard deviation is labeled correctly; bars do not imply statistical significance. |
| Score authentication and network failures | Invalid/revoked keys, rate limits, blocked network, malformed responses, and offline use leave the last valid snapshot usable and produce a helpful status without disclosing the key. |
| Score storage and clearing | Restart preserves the public snapshot and local references without a refresh. Disconnect and Clear Scores removes the key, scores, and links, including during an in-flight request; the GitHub catalog and discovery history remain. |
| Score request privacy | Requests use fixed OpenRouter endpoints with no prompts, discovered/private model names or IDs, reference choices, workspace content, or inference calls. |
| Light/dark/high contrast | Text, focus, selection, bars and table labels remain legible. |
| Keyboard and screen reader | Tabs, tasks, search, comparison, tables and source actions are understandable without a pointer. |

Do not request inference just to verify discovery or charts. Authenticated OpenRouter downloads must be checked separately with a user's own key before claiming live-service validation; fixtures prove behavior, not current API availability or score coverage. Do not log keys, identifiers, or account-specific output into public issues.

## Eight-person usability pilot

Recruit eight paid Copilot users who choose models manually. Observe choices for a small edit, a difficult debugging/refactoring task, and larger agentic work. Compare their existing approach and the closest competitor with this extension; alternate task/order to reduce learning effects.

Ask each participant to explain their model choice, identify its supporting source, explain why editorial guidance is not a measured ranking, and explain what discovery proves. Record time and comprehension locally with consent; no extension telemetry is needed.

Proposed public-release gate: at least five of eight users choose and explain a suitable option within 60 seconds, understand the evidence limitations, and prefer the workflow. At least four voluntarily return for a real choice during a two-week beta. These are early product hypotheses, not statistically conclusive retention metrics. If they fail, improve the workflow before adding more features.

## Maintenance ownership

Assign a repository maintainer before publication. Review GitHub's support, pricing, and task guidance before updating the catalog. Preserve licenses, pinned sources, and review dates. A successful download or schema check does not establish editorial accuracy; increase `reviewedAt` only after reviewing the content.
