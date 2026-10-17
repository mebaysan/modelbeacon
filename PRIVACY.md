# Privacy

ModelBeacon does not collect analytics or send inference requests. It does not read workspace files, code, prompts, chat histories, account balances, credentials from installed model providers, or Copilot's internal databases. The optional published-score connection uses an OpenRouter API key that you explicitly provide.

When you request detection, the extension calls `vscode.lm.selectChatModels()` without a provider filter. It reads metadata for exposed Copilot, organization, BYOK/custom, and other installed-provider models. It cannot guarantee that these results match any provider's picker. VS Code and the providers handle authentication or provider requests under their own policies. This extension does not send prompts or use models to perform measurements.

Detection saves only model `id`, `name`, `vendor`, `family`, `version`, `maxInputTokens`, and a `lastSeen` timestamp. The cache uses VS Code's local extension `globalState`; because this is a desktop UI extension, that storage is on the local machine, including during remote-workspace use. Model metadata is not sent to a catalog service, saved in the repository, or registered for Settings Sync. Detection does not read or store endpoint configurations, API keys, prompts, or responses.

Saved model metadata survives restarts and offline use and is labeled with its last-seen time, not treated as current availability. Loading the cache does not contact providers. Automatic discovery refresh is enabled only after explicit detection during the current session. **Clear Local Models** removes all saved model metadata, current discovery results, and score reference links that contain runtime identities while keeping the public catalog; the next explicit detection can populate the model cache again.

Published builds may download the reviewed catalog over HTTPS. Automatic checks happen only when the explorer is opened and at most once daily. The hosting provider can receive normal HTTP metadata such as your IP address, request time, and cached ETag. The request does not include model identities, workspace content, account details, or an analytics identifier. Disable automatic checks in `llmBench.autoUpdateCatalog`. Manual refresh explicitly requests an update. Local builds without a catalog URL make no catalog requests.

The last validated public catalog, its ETag, and last request time also use local extension global state. Search, task, and comparison selections are saved in the webview's local state. These caches are not configured for Settings Sync. The automatic-update preference is a VS Code user setting and may be synchronized according to your VS Code configuration.

## Optional published scores

Connecting scores prompts for an OpenRouter API key in a native VS Code password input. The extension stores that key through VS Code SecretStorage. It does not put the key in the webview, user or workspace settings, the repository, or the model/score caches. The extension reads the saved key only to manage the connection and authenticate requests to OpenRouter's fixed HTTPS benchmark endpoints.

Connecting downloads scores. Each **Show score charts** click also requests a fresh score snapshot using the saved key; if no key is saved, it opens the native password prompt first. **Refresh scores** requests a download separately. **Link score reference** and **Change score reference** download scores if no snapshot is cached. Opening the extension, rendering charts, loading a cache, discovering models, and changing the composite-index setting do not refresh scores. Selecting a reference from the loaded picker saves a local association without sending that choice to OpenRouter.

These requests download public benchmark data and authenticate with the supplied key. OpenRouter receives that credential and ordinary request metadata such as your IP address and request time. Requests do not contain workspace content, prompts, discovered/custom model names or IDs, or your local reference choices. OpenRouter applies its own [privacy policy](https://openrouter.ai/privacy) and API access policies.

The validated public score snapshot, source attribution and dates, retrieval time, and your explicit model-to-reference choices are stored in local extension global state and are not registered for Settings Sync. References can include local custom model identities; they are not written into the public catalog or repository. Cached data remains usable offline and stays visible while a refresh is pending. Failed refreshes preserve the last valid snapshot. Chart rendering itself uses this data locally; the download is triggered by the actions described above.

Composite indices are disabled by default. Enabling `llmBench.includeCompositeScores` permits scores whose methodology can include Terminal-Bench; it does not enable inference or a direct Terminal-Bench import. This is an application setting, separate from the local score cache and reference choices. There is no background score collection.

**Disconnect and Clear Scores** deletes the OpenRouter key, cached scores, and local reference choices. This action keeps discovered model history and the public catalog. **Clear Local Models** clears discovery history and runtime-model reference links separately; it keeps the OpenRouter connection, public score snapshot, and catalog-model references. Removing a reference does not send a request to OpenRouter.

Source/help buttons open the requested external website in your browser. Those websites have their own privacy policies. No external scripts, fonts, or images are loaded into the extension interface.

The extension is independent of GitHub and Microsoft. Data is provided for comparison, not as a record of your subscription or usage.
