# Release validation

Automated tests establish implementation behavior. They do not establish account entitlement parity, actual Copilot performance, or product demand.

## Automated

- `npm run check`: TypeScript checks for the extension, shared logic, webview, scripts, and tests.
- `npm test`: catalog validation, identity matching, guidance filtering, benchmark compatibility, pricing expiry, cache/update failures, size limits, and refresh concurrency. Local-model checks cover metadata allowlisting, restart without discovery, vendor/version separation, and clearing during pending discovery or storage writes. Published-score checks use fixtures to verify response validation, metric policy, explicit references, cache preservation, and credential handling without authenticated API calls.
- `npm run catalog:check`: production catalog structure and references. The bundled catalog contains no benchmark observations.
- `npm run test:ui`: desktop and narrow Chromium interactions, keyboard tabs, search persistence, comparison limits, generic matching/mismatched benchmark layouts using test fixtures, unavailable data, unsafe text, and viewport containment. Custom-model checks cover mixed comparisons, evidence isolation, offline labels, and clearing persisted selections. Published-score fixtures exercise comparison/detail charts, reference actions, and the default exclusion of composite indices.
- `npm run test:extension`: activation, command registration, singleton editor behavior, and close/reopen in an isolated real VS Code instance.
- `npm run package`: prepublish checks and installable VSIX packaging.

CI runs checks and packaging on Windows, macOS, and Linux. Browser and native extension-host tests run on Linux. A configured workflow is not evidence that it has run successfully on GitHub yet.

## Listing and media checks

- Keep the manifest description, README, feature labels, and screenshots consistent: score charts are optional, references are selected explicitly, and composite indexes are off by default.
- Inspect the home, comparison, and model-details screenshots at readable sizes. Score examples must use fictional model names and display a visible illustrative-data notice; README captions must also say the values are not measured model results. Never substitute fabricated values for a real model's results.
- Check the hero and packaged icon render without clipping, and preserve a legible monochrome Activity Bar icon.
- Verify every README image and documentation path exists. Inspect the packaged local VSIX's extension details page for readable feature and installation copy. Relative images are intentionally omitted from that local page until public asset URLs are configured; the illustrated source README remains available.
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
| Score reference selection | Link, change, and unlink a reference for both catalog and custom models. Links persist locally, retain vendor/version distinctions, and never claim a verified deployed-model match. |
| Downloaded scores with no references | After a successful connection or cache reload, explain that a reference must be selected. Show score charts on home and explore cards opens the details and native picker; selecting a reference reveals charts without another download. |
| Reopening linked charts | Show score charts reveals the saved reference's charts without reopening the picker or changing the link. This works for catalog and custom models. |
| Default score policy | GPQA Diamond and τ-bench Verified Airline can appear; Artificial Analysis composite indices remain excluded until explicitly enabled. Enabling the setting does not download data until refresh is requested. |
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
