# Developing and releasing ModelBeacon

For the product tour and [Marketplace installation](https://marketplace.visualstudio.com/items?itemName=mebaysan.modelbeacon), see the [README](../README.md). This guide covers the local workflow, upgrades, architecture, catalog hosting, and release preparation. Marketplace availability does not establish completion of the user beta or account-specific validation.

## Local development

Use Node.js **22.18+**, npm, and GNU Make (including macOS's bundled Make). Run `make` or `make help` to list local commands. The Makefile delegates to npm scripts, which remain usable directly on systems without Make.

```sh
make setup           # Install locked dependencies and Chromium once
make build           # Compile extension and webview
make check           # TypeScript and catalog validation
make test            # All checks and test suites
make preview         # Browser preview; Ctrl+C stops it
make dev             # Launch the extension in a development window
make package         # Produce modelbeacon.vsix
make install         # Package and install/update it in your local VS Code
```

After `make setup`, use `make dev` or press **F5** in VS Code to open an Extension Development Host. Both the sidebar and editor dashboard are available there. Browser-hosted VS Code is not supported by this release.

Run individual suites with `make test-unit`, `make test-ui`, or `make test-extension`. Test targets run sequentially even with `make -j` because they share build output. `make clean` removes `dist/`, `modelbeacon.vsix`, and browser test reports; it keeps `node_modules/`, downloaded VS Code/Chromium caches, and local model data.

`make dev` and `make install` require the `code` command on PATH. Override it when needed:

```sh
make dev CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
```

`make install` replaces an installed ModelBeacon build, including the same version. `make dev` does not install a VSIX. Disable the earlier Copilot Model Explorer build before using either command.

### Without Make

The equivalent npm commands remain available:

```sh
npm ci
npx --no-install playwright install chromium
npm run build
npm run check
npm run catalog:check
npm test
npm run test:ui
npm run test:extension
npm run package
```

Use **F5** for the development host. To install the packaged extension, run `code --install-extension modelbeacon.vsix --force` or **Extensions: Install from VSIX…**.

### Test environments and preview

`make test-extension` downloads pinned VS Code 1.140.0 and uses an isolated profile. Set `VSCODE_EXECUTABLE_PATH` to test an existing executable, or `VSCODE_VERSION` for another release. Tests never sign in or send model requests. Linux systems may need Chromium system libraries (`npx playwright install --with-deps chromium`) and a display for native tests, for example `xvfb-run -a make test-extension`.

`make preview` serves the development-only browser preview at `http://127.0.0.1:4173`; use `PORT=4200 make preview` to change the port. Detection and added-catalog controls use clearly labeled fixtures; native URL inputs and file dialogs belong to the extension host. Published-score test fixtures are examples, not live model measurements. The preview bridge is excluded from the VSIX. Setup, native test downloads, and any configured catalog feed can require network access; no publisher credentials are needed for the local workflow. Actual score downloads need a user-provided OpenRouter API key; building and running automated tests do not.

See [release validation](validation.md) for what the automated suites establish and the account, accessibility, environment, and usability checks still required before public release.

## Upgrading the earlier local build

Uninstall or disable **Copilot Model Explorer** (`baysansoft.copilot-model-explorer`) before installing **ModelBeacon** (`mebaysan.modelbeacon`). The corrected publisher and name give ModelBeacon a new extension identity and local cache, so detect your models again. Existing `llmBench.*` command and setting IDs are retained.

Later ModelBeacon builds can be installed with `make install`; it updates the same extension identity. Clearing local model history is available through the UI or **ModelBeacon: Clear Local Models**. This also clears score reference links containing runtime identities; the score connection, public score snapshot, and catalog-model references remain. The next explicit detection can save the models again.

## Architecture and data behavior

The extension uses TypeScript, esbuild, the stable VS Code API, and native HTML/CSS/SVG. There are no production npm dependencies. Shared core logic validates catalogs, maps reviewed aliases, filters task guidance, checks comparison compatibility, and handles price expiry. The extension host owns networking and VS Code access; webviews receive data and send a small validated set of actions.

Discovery uses `vscode.lm.selectChatModels()` to read models exposed by installed providers. It does not register providers or configure endpoints. Explicit detection saves only `id`, `name`, `vendor`, `family`, `version`, `maxInputTokens`, and `lastSeen` in local extension storage. The cache retains the 1,000 most recently seen identities, separated by provider, model ID, and version. It is not written to the repository, published with the catalog, or registered for Settings Sync.

Loading saved metadata does not trigger discovery. Automatic model refresh starts only after explicit detection in the current session. Saved models keep last-seen labels and do not count as currently available. Enabling **Available models only** requests detection when needed and applies across the task and comparison tabs within that view. The sidebar and editor retain their own filter selections. Empty or failed detection never substitutes public-catalog models.

Preserve these evidence distinctions when changing the product:

- Task guidance is sourced editorial interpretation. Shortlisted choices display alphabetically and are not a measured ranking or guarantee.
- API discovery does not establish account entitlement, exact picker parity, or equivalence to a public model snapshot. Custom identities receive no guessed public-model claims or Copilot rates.
- The bundled catalog has no benchmark observations or measured rankings. Added catalogs may contain sourced observations with their evaluation configuration; their comparison groups stay separate from the base and other added catalogs. Optional OpenRouter scores use a separate local snapshot and automatically resolved references with optional manual overrides. They do not alter task guidance, establish deployed-model equivalence, or populate the public catalog.
- Built-in pricing means GitHub's published USD rates per million tokens for AI-credit billing, including cache and context tiers. Added-catalog pricing belongs to its own source and is not labeled as a Copilot rate. Neither is usage measurement or a personal bill; expired promotions are hidden and legacy annual-plan billing is linked separately.
- API input limits remain separate from advertised context windows. Copilot Free/Student plans and organization policy may restrict selection; the interface links to GitHub's explanation of Auto.

See the [privacy policy](../PRIVACY.md) for storage and network behavior. The extension makes no inference requests or benchmark runs. It accepts catalog observations only with required source references and evaluation context. The public catalog, added catalogs, local model cache, and optional public-score cache have separate storage and clearing behavior.

### Added catalogs

`ExtraCatalogStore` validates standalone schema v1/v2 catalogs and merges them into the current base in memory. It saves at most ten catalogs of 2 MiB each in local extension storage. Base model IDs and aliases win, followed by previously added catalogs; conflicts are skipped. Source IDs, observation IDs, and comparison groups are scoped to each added catalog. User catalogs are never written into `data/catalog.json`, uploaded, or registered for Settings Sync.

**Your catalogs** exposes URL addition, native JSON selection, URL refresh, and removal in both views. URL downloads use HTTPS without credentials or redirects and retain the last valid snapshot on failure. JSON imports save a snapshot and filename, with no file watcher or retained path. Removal also clears comparison selections and manual score links for model IDs no longer present. See [the format and example](extra-catalogs.md) before adding data or extending validation.

### Published score integration

**ModelBeacon: Connect OpenRouter Scores** uses a native password prompt and VS Code SecretStorage, then requests the public score snapshot. **Add to compare**, **View comparison**, and **Show score charts** also load scores with the saved key, prompting to connect first when needed. **Refresh Model Scores** remains a separate explicit refresh action. The key never enters webview state, settings, model caches, or the repository. Network requests go only to fixed OpenRouter HTTPS benchmark endpoints; discovered identities and reference choices are not sent. The extension discards OpenRouter pricing fields and keeps GitHub Copilot prices separate.

GPQA Diamond and τ-bench Verified Airline are enabled by default. `llmBench.includeCompositeScores` defaults to `false`; enabling it permits Artificial Analysis intelligence, coding, and agentic indices whose methodology can incorporate Terminal-Bench. A setting change does not fetch data; use **Show score charts** or **Refresh Model Scores** afterward. There is no direct Terminal-Bench integration or scheduled benchmark import.

**Add to compare**, **View comparison**, and **Show score charts** download scores and render automatically resolved references. A saved manual override takes precedence. Otherwise, a shared resolver checks qualified IDs and unique normalized names while preserving version and reasoning distinctions. Unmatched or ambiguous identities remain unavailable. Automatic resolution runs locally and does not save a user-reference link or send model names to OpenRouter.

Only the explicit **Link score reference** or **Change score reference** controls open a native reference picker. **Reset to automatic** removes the saved override. These references describe external evaluations, not proof of an identical provider deployment. **Disconnect and Clear Scores** deletes the key, public-score snapshot, and manual overrides while preserving discovered model history and the GitHub catalog.

Overlapping requests share a download. Cached charts remain visible during refreshes and after failures. Opening the extension, rendering charts, restoring cached selections, removing models, clearing a comparison, and changing settings do not start a score download. There is no background refresh.

Render separate charts per metric with numeric labels, units, source attribution, and snapshot dates. Accuracy percentages and index points must not share a scale or become a combined winner score. Unknown results remain unavailable. Show reported uncertainty only with its actual meaning; standard deviation is not a confidence interval, and missing uncertainty must not be invented. An API snapshot does not guarantee identical evaluation configurations across models or statistical significance.

Score charts include links to the CC BY 4.0 license and OpenRouter attribution guidance. Supplied citations, source names, HTTPS source URLs, API versions, and dates remain attached to their score records. The optional metadata fields keep `scoreCache.v1` compatible with older snapshots; loading them does not require a migration or a download. Source links resolve from validated host-side records and open only when clicked.

## Catalog feed and maintenance

The extension opens from bundled or cached catalog data immediately. A build with a configured endpoint checks that endpoint at most once daily when opened. Added URL catalogs use the same automatic-update preference and their own daily request times. `llmBench.autoUpdateCatalog` controls automatic checks; manual refresh still works. Invalid downloads, network errors, and unsupported schema versions preserve the last valid data. Guidance older than 14 days without human review is visibly marked even when factual data was synchronized recently.

Local builds have **no public catalog endpoint by default**. The release workflows default to `https://mebaysan.github.io/modelbeacon/catalog/v2.json`; the repository variable `LLMBENCH_CATALOG_URL` overrides that address. For a local feed-enabled build, set the same environment variable before `npm run build`. The public endpoint is compiled into the extension and cannot be changed by workspace settings. Catalog downloads need no API key or paid backend. Hosting receives ordinary HTTP request metadata when an update is requested, but no model identities or workspace content.

**Sync and publish catalog** runs daily at 06:23 UTC, on relevant changes pushed to `main`, and through **Run workflow**. It reads structured tables and documented conditions from the official `github/docs` repository, validates them, and deploys the generated v2 feed to GitHub Pages. The existing bundled snapshot is also served at `/catalog/v1.json` for older clients. Source-format changes, unsupported conditions, and failed checks stop deployment, preserving the previously published feed. No repository commit or extension release is needed for each factual update.

Set up hosting once:

1. In repository **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Run **Sync and publish catalog** and confirm its successful deployment and `/catalog/v2.json` endpoint.
3. Publish the 0.5.0 extension version containing the feed URL. Existing installed versions cannot gain a compiled endpoint from a Pages deployment alone.

No custom secret is needed for catalog synchronization or Pages deployment. Source access and deployment use the workflow's GitHub permissions. Marketplace credentials are separate. Review generated data locally with `npm run catalog:sync`; it writes `artifacts/site/catalog/v2.json` by default. See [catalog maintenance](catalog.md) for importer behavior, source attribution, and manual review steps. Task advice and runtime aliases remain curated; synchronization never advances the human review date or guesses aliases for a new model.

Revisions use `YYYY-MM-DD.N`, with a numeric sequence for same-day corrections. In schema v1 the date matches `reviewedAt`; schema v2 can use `syncedAt` while retaining the actual human `reviewedAt`. Automated pricing uses its own `syncedAt`, without claiming human review. Clients reject older revisions and unsupported schemas. To roll back data, fix the source/importer or curate the correction and publish it as a newer revision; do not rely on a lower revision replacing a cache.

## Publishing

The editable brand assets are `media/icon.svg` and `media/hero.svg`; their PNG exports are used by the listing and README. `media/activity-bar.svg` is the monochrome 24px variant shared by the Activity Bar and dashboard. README screenshots under `media/screenshots/` show the extension's UI through its development preview, without account data. `home.png` shows public-catalog guidance. `comparison.png` and `model-details.png` use fictional Example Model A, B, and C with synthetic scores; retain their visible sample-data labels and README captions whenever refreshing these images. These screenshots show the default reasoning and tool-use charts, with optional composite indexes disabled.

### GitHub-hosted listing images

The public repository is [mebaysan/modelbeacon](https://github.com/mebaysan/modelbeacon). Both `npm run package` and `npm run package:release` retain the illustrated README. The manifest's `repository` URL lets VSCE rewrite relative image and documentation paths to public HTTPS URLs, using `main` for local packages. No separate image host or GitHub Pages deployment is needed. [VS Code link-rewriting documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#marketplace-integration).

Release workflows pass `--githubBranch "$GITHUB_SHA"` so images and documentation refer to the exact packaged commit. Keep `media/hero.png` and `media/screenshots/*.png` committed. Local edits to images become publicly visible after they are pushed; loading listing images requires a network connection. The explorer's own UI assets remain packaged locally.

### Marketplace credentials

The workflow uses Microsoft Entra authentication through VSCE. Its credentials are GitHub repository secrets, exposed only to the publish step. Microsoft retires global Azure DevOps PATs on December 1, 2026; this workflow uses Entra credentials instead. [Current publishing guidance](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

1. Create or use the Marketplace publisher **mebaysan** and set its website to **https://mebaysan.com**. The publisher profile is managed separately from `package.json`.
2. Create a Microsoft Entra app registration and client secret. Record the tenant ID, application/client ID, and the secret **value**, not its secret ID.
3. Authenticate as that service principal following Microsoft's [Entra publishing setup](https://learn.microsoft.com/en-us/azure/devops/extend/publish/command-line?view=azure-devops#publish-with-a-microsoft-entra-token). Obtain its Marketplace profile ID using:

   ```sh
   az rest --url https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource 499b84ac-1321-427f-aa17-267ca6975798
   ```

4. In Marketplace publisher **mebaysan → Members → Add**, add the returned profile `id` with **Contributor** access. This is the identity's Marketplace profile ID, not its application/client or directory object ID. See [publisher roles](https://learn.microsoft.com/en-us/visualstudio/extensibility/walkthrough-publishing-a-visual-studio-extension?view=visualstudio#add-additional-users-to-manage-your-publisher-account). If identity lookup fails, complete Microsoft's tenant/organization service-principal setup from the linked instructions.
5. Under [repository Settings → Secrets and variables → Actions](https://github.com/mebaysan/modelbeacon/settings/secrets/actions), add these repository secrets:

   | Secret | Value |
   | --- | --- |
   | `AZURE_TENANT_ID` | Microsoft Entra directory/tenant ID |
   | `AZURE_CLIENT_ID` | App registration application/client ID |
   | `AZURE_CLIENT_SECRET` | Client secret value |

Renew the client secret before its expiry and update the repository secret. The user-facing OpenRouter key is unrelated and is never used for publishing. The installed VSCE supports these variables through [EnvironmentCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/environmentcredential?view=azure-node-latest), so no Azure login action is required in the workflow.

### Publish a version

1. Complete [release validation](validation.md). Increase the stable version in both package files, for example with `npm version patch --no-git-tag-version`, and move the relevant `CHANGELOG.md` entries into that version's section. Use `minor` or `major` instead of `patch` when appropriate.
2. Commit the changes, including the workflows and listing images, and push or merge them to `main`.
3. **Release and publish extension** compares the resulting `package.json` version with the version before the push. An increased stable version starts a release; an unchanged version skips publication. Invalid versions, decreases, or mismatched lockfile versions fail validation. Make one release version per push.
4. The workflow checks the publisher and package name; runs type, catalog, unit, browser, and native VS Code checks; and packages a VSIX with image and documentation links pinned to the triggering commit. It creates the matching `vVERSION` tag and GitHub Release with generated release notes, attaches `modelbeacon.vsix`, and publishes that exact package to Marketplace. Release jobs are queued so one version publishes at a time.

GitHub supplies the repository token used to create the tag, release, and asset. Only the release job has `contents: write`; no extra GitHub token secret is needed. Marketplace still requires the three Entra secrets above. Repository rules must allow the workflow to create release tags. GitHub releases created with `GITHUB_TOKEN` do not start another release-triggered workflow, so creation and Marketplace publication happen in the same run. [GitHub workflow-trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

If publication fails, fix the cause and rerun the failed workflow. It reuses an existing release VSIX and skips a Marketplace version that is already published. A tag pointing to a different commit fails instead of being moved. Do not replace a published version; increase the version for a corrected package.

Publishing a stable GitHub Release manually remains supported: its tag must equal `v` plus the package version, for example `v0.5.0` for `0.5.0`. Drafts and prereleases do not publish to Marketplace, and pushing a tag alone does not trigger publication. Normal releases need only the version increase on `main`.

The optional repository **variable** `LLMBENCH_CATALOG_URL` overrides the default GitHub Pages v2 endpoint. Leaving it unset keeps that default for release workflows. Listing images are served by the repository and do not depend on Pages or this setting. Local `npm run build` remains offline unless a feed URL is explicitly supplied.

**Build release VSIX** remains available manually to produce an artifact without publishing; its optional catalog URL input overrides the repository variable or default Pages feed. Local release packaging also works:

```sh
npm run package:release -- --githubBranch main
```

Use a pushed commit SHA instead of `main` to pin a local review package to immutable content. Actual Marketplace authentication and publication require the configured secrets and publisher access; local builds do not perform either action.

The code is [MIT licensed](../LICENSE). Third-party facts retain their source licenses and attribution in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). No third-party benchmark dataset is bundled.
