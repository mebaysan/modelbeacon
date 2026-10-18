# Changelog

## 0.5.0

- Add score license and attribution links to comparison and model details, preserving supplied source metadata while keeping existing score caches readable.
- Identify the publisher, privacy contact, policy update date, and default catalog hosting provider in the privacy policy.
- Automatically synchronize public model facts and prices from GitHub's official documentation, publishing a versioned catalog feed daily and on demand.
- Keep automated sync dates separate from human guidance review dates, and retain the previous catalog when validation or downloads fail.
- Append up to ten user catalogs from HTTPS URLs or JSON files, stored locally with source labels and conflict counts. Built-in models and earlier catalogs take precedence.
- Refresh URL catalogs automatically, compare added models alongside built-in models, and remove catalog snapshots and orphaned comparison/reference selections.
- Automatically create a tagged GitHub Release, attach the VSIX, and publish it to Marketplace when a stable version increase reaches `main`.
- Reuse existing release packages on retries and reject tags that point to a different commit.

## 0.4.4

- Resolve published references automatically from model IDs and names when comparing or opening score charts; no reference-picker prompt is required.
- Preserve manual reference overrides and leave ambiguous or missing matches unavailable.
- Add Marketplace publishing on stable GitHub Releases using Microsoft Entra credentials from repository secrets.
- Host listing images and documentation on the public GitHub repository, with release links pinned to their commit.

## 0.4.3

- Fetch published scores automatically when adding models to a comparison or choosing View comparison.
- Reuse saved references immediately; guide unlinked models through one reference picker at a time, without a separate refresh step.
- Share concurrent comparison downloads and preserve cached charts when a refresh fails.

## 0.4.2

- Make Show score charts load scores automatically with the saved OpenRouter key, including before any scores have been downloaded.
- Open the secure connection prompt when a key is needed, then continue to reference selection and charts without a separate refresh step.
- Refresh linked model charts on click while preserving cached results during downloads and failures; share concurrent requests.
- Allow reference selection to load missing scores directly, and update setup instructions and privacy notices for these user-triggered downloads.

## 0.4.1

- Make downloaded charts discoverable with a Show score charts action on task, catalog, and custom-model cards; guide users through choosing a reference when none is linked.
- Show downloaded score coverage and explain the next step when an API key is connected but model references have not been selected.
- Refresh the extension description, search keywords, and in-app explanations for published score charts and local reference links.
- Update the installation guide and product tour with comparison and model-detail charts, setup steps, and data-source limitations.
- Replace the promotional banner and interface screenshots, with fictional models and clearly labeled sample scores in chart previews.
- Align privacy, third-party notices, development, and validation guidance with the score connection and local data controls.

## 0.4.0

- Download published benchmark scores from OpenRouter on demand and cache them on the user's device.
- Add accessible statistical bar charts to model comparisons and public/custom model details, with separate metrics, source dates, sample counts, and reported standard deviations.
- Link models explicitly to published references; organization model identities and reference links stay local.
- Keep the OpenRouter API key in VS Code secret storage. Disconnect removes the key, score cache, and reference links.
- Default to GPQA Diamond and τ-bench verified airline scores. Artificial Analysis composite intelligence, coding, and agentic indexes require an explicit opt-in because they can include Terminal-Bench results indirectly.

## 0.3.2

- Remove Terminal-Bench results, source records, importer, and scheduled review workflow.
- Keep model discovery, local history, task guidance, published pricing, and metadata comparisons.
- Hide benchmark sections when the catalog contains no observations; update the listing and screenshots to describe the remaining comparisons.
- Advance the bundled catalog revision so an older cached catalog cannot restore removed results.

## 0.3.1

- Add a full-color lighthouse icon for the extension listing, with matching Activity Bar and dashboard icons.
- Rewrite the installation page with a product tour, quickstart, model-discovery guidance, privacy details, and FAQs.
- Add a branded banner and real interface screenshots to the illustrated README; move contributor instructions to a dedicated development guide.
- Package a text-only installation page for local builds until documentation images have public HTTPS URLs.

## 0.3.0

- Rename the extension to ModelBeacon, published by `mebaysan` with homepage `https://mebaysan.com`.
- Add a beacon icon in the Activity Bar, a sidebar home view, and an Open in Editor action for wide comparisons.
- Add an Available models only filter on the home view, shared with Explore & compare; cached-only models do not count as available.
- Keep currently detected custom models visible even when reviewed task guidance is unavailable.
- The new extension identity starts with fresh local storage; disable or uninstall the previous local build before upgrading.

## 0.2.0

- Detect models exposed by all installed VS Code providers, including organization and custom models.
- Save allowlisted model metadata locally with last-seen timestamps for restart and offline browsing.
- Compare custom model metadata beside public models without inferred benchmark or Copilot pricing matches.
- Clear saved model metadata and current discovery through the UI or Command Palette.
- Keep discovery explicit each session; loading cached models does not contact providers.

## 0.1.0

- Four task categories with source-attributed shortlists.
- Public catalog and optional Copilot model discovery using stable VS Code APIs.
- Comparison of up to three models, published pricing, and external benchmark observations.
- Charts only for verified compatible evaluation configurations.
- Bundled/cached catalog, validated HTTPS updates, stale-data and expired-price handling.
- Keyboard navigation, native theme colors, and accessible comparison tables.
- Catalog import/review and static publication workflows, automated tests, and local VSIX packaging.
