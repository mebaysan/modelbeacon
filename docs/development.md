# Developing and releasing ModelBeacon

For the product tour and installation from an existing VSIX, see the [README](../README.md). This guide covers the local workflow, upgrades, architecture, catalog hosting, and release preparation. Version 0.4.4 has not been published to the Marketplace or validated with a user beta.

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

`make preview` serves the development-only browser preview at `http://127.0.0.1:4173`; use `PORT=4200 make preview` to change the port. Its detection button uses clearly labeled fixture data. Published-score test fixtures are examples, not live model measurements. The preview bridge is excluded from the VSIX. Setup, native test downloads, and any configured catalog feed can require network access; no publisher credentials are needed for the local workflow. Actual score downloads need a user-provided OpenRouter API key; building and running automated tests do not.

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
- The bundled catalog has no benchmark observations or measured rankings. Optional OpenRouter scores use a separate local snapshot and automatically resolved references with optional manual overrides. They do not alter task guidance, establish deployed-model equivalence, or populate the public catalog.
- Pricing means GitHub's published USD rates per million tokens for AI-credit billing, including cache and context tiers. It is not usage measurement or a personal bill; expired promotions are hidden and legacy annual-plan billing is linked separately.
- API input limits remain separate from advertised context windows. Copilot Free/Student plans and organization policy may restrict selection; the interface links to GitHub's explanation of Auto.

See the [privacy policy](../PRIVACY.md) for storage and network behavior. The extension makes no inference requests and does not accept custom benchmark uploads. The public catalog, local model cache, and optional public-score cache have separate storage and clearing behavior.

### Published score integration

**ModelBeacon: Connect OpenRouter Scores** uses a native password prompt and VS Code SecretStorage, then requests the public score snapshot. **Add to compare**, **View comparison**, and **Show score charts** also load scores with the saved key, prompting to connect first when needed. **Refresh Model Scores** remains a separate explicit refresh action. The key never enters webview state, settings, model caches, or the repository. Network requests go only to fixed OpenRouter HTTPS benchmark endpoints; discovered identities and reference choices are not sent. The extension discards OpenRouter pricing fields and keeps GitHub Copilot prices separate.

GPQA Diamond and τ-bench Verified Airline are enabled by default. `llmBench.includeCompositeScores` defaults to `false`; enabling it permits Artificial Analysis intelligence, coding, and agentic indices whose methodology can incorporate Terminal-Bench. A setting change does not fetch data; use **Show score charts** or **Refresh Model Scores** afterward. There is no direct Terminal-Bench integration or scheduled benchmark import.

**Add to compare**, **View comparison**, and **Show score charts** download scores and render automatically resolved references. A saved manual override takes precedence. Otherwise, a shared resolver checks qualified IDs and unique normalized names while preserving version and reasoning distinctions. Unmatched or ambiguous identities remain unavailable. Automatic resolution runs locally and does not save a user-reference link or send model names to OpenRouter.

Only the explicit **Link score reference** or **Change score reference** controls open a native reference picker. **Reset to automatic** removes the saved override. These references describe external evaluations, not proof of an identical provider deployment. **Disconnect and Clear Scores** deletes the key, public-score snapshot, and manual overrides while preserving discovered model history and the GitHub catalog.

Overlapping requests share a download. Cached charts remain visible during refreshes and after failures. Opening the extension, rendering charts, restoring cached selections, removing models, clearing a comparison, and changing settings do not start a score download. There is no background refresh.

Render separate charts per metric with numeric labels, units, source attribution, and snapshot dates. Accuracy percentages and index points must not share a scale or become a combined winner score. Unknown results remain unavailable. Show reported uncertainty only with its actual meaning; standard deviation is not a confidence interval, and missing uncertainty must not be invented. An API snapshot does not guarantee identical evaluation configurations across models or statistical significance.

## Catalog feed and maintenance

The extension opens from bundled or cached catalog data immediately. A build with a configured endpoint checks that endpoint at most once daily when opened. `llmBench.autoUpdateCatalog` controls automatic checks; manual refresh still works. Invalid downloads, network errors, and unsupported schema versions preserve the last valid catalog. Data older than 14 days is visibly marked.

Local builds have **no catalog endpoint by default** and make no catalog update requests. Set `LLMBENCH_CATALOG_URL` to the HTTPS address of the published catalog when building a release. The endpoint is compiled into the extension and cannot be changed by workspace settings. Catalog downloads need no API key or paid backend. Hosting receives ordinary HTTP request metadata when an update is requested, but no model identities or workspace content.

See [catalog maintenance](catalog.md) for provenance, manual review steps, and licensing. A maintainer reviews model aliases, task advice, and current GitHub facts/prices before updating the bundled catalog or publishing a new feed revision. There is no scheduled upstream import.

To roll back an online catalog, restore the previous reviewed content in a new revision and use the actual new review date, then republish. Revisions use `YYYY-MM-DD.N`, with a numeric sequence for same-day corrections. Clients reject older revisions and unsupported schemas. To change the schema, update the extension and endpoint version together.

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

1. Complete [release validation](validation.md). Set the same new version in `package.json` and `package-lock.json`, and update `CHANGELOG.md`.
2. Commit and push the changes, including the workflows and listing images.
3. Create and publish a **stable GitHub Release** with a matching tag, for example `v0.4.4` for version `0.4.4`. Drafts and prereleases do not publish to Marketplace, and pushing a tag alone does not trigger this workflow.
4. **Publish to VS Code Marketplace** checks the tag, publisher, package name, and lockfile versions; runs type, catalog, unit, browser, and native VS Code checks; packages a VSIX; uploads it as a workflow artifact; and publishes that exact file. Concurrent releases are serialized. Rerunning an already published version skips it instead of overwriting it.

The optional repository **variable** `LLMBENCH_CATALOG_URL` can supply a deployed HTTPS catalog endpoint. Leave it unset for bundled-catalog-only releases. Images do not depend on this setting. To deploy the reviewed catalog separately, enable Pages with GitHub Actions as its source and run **Publish reviewed catalog**; then configure the deployed `/catalog/v1.json` URL.

**Build release VSIX** remains available manually to produce an artifact without publishing; its catalog URL input is optional. Local release packaging also works:

```sh
npm run package:release -- --githubBranch main
```

Use a pushed commit SHA instead of `main` to pin a local review package to immutable content. Actual Marketplace authentication and publication require the configured secrets and publisher access; local builds do not perform either action.

The code is [MIT licensed](../LICENSE). Third-party facts retain their source licenses and attribution in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). No third-party benchmark dataset is bundled.
