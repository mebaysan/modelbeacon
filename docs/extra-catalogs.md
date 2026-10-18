# Add your own catalogs

ModelBeacon can append catalogs from HTTPS URLs and JSON files. They appear beside the built-in public catalog, with their own source labels, model details, and comparisons. Importing a catalog does not configure a model provider or establish account access.

## Add, refresh, and remove

In **Your catalogs** on the home view or editor dashboard:

- **Add catalog URL** opens a native VS Code input. Enter a direct HTTPS URL serving ModelBeacon catalog JSON. Redirects and URLs with embedded username/password credentials are rejected; authentication headers and browser cookies are not sent.
- **Import JSON file** opens the file picker and saves the selected catalog as a local snapshot. The extension retains the filename, not its full path, and does not watch the file. Remove and import again after editing it.
- **Refresh added catalogs** checks saved URL sources immediately. They also refresh at most once daily when ModelBeacon opens if automatic catalog updates are enabled. A failed or invalid update keeps the previous snapshot.
- **Remove** deletes the saved catalog and URL. Its models disappear from comparisons, and manual score references are removed for model IDs no longer present. Other catalogs, detected-model history, and the OpenRouter connection remain.

The panel shows the number of models appended and skipped. You can save up to **ten catalogs**, each no larger than **2 MiB**. URLs, snapshots, and imported model data stay in local extension storage; they are not added to this repository or registered for Settings Sync. URL labels display the hostname, but the complete URL is saved and sent to that host. Avoid URLs containing secrets in their path or query. [Full privacy policy](../PRIVACY.md).

## Catalog format

Start with [example-catalog.json](example-catalog.json). It contains one explicitly fictional model, no guessed runtime aliases, and no benchmark results. Replace its example names and source links with your own evidence before using it as a real model reference.

Each file or URL must contain a **complete, standalone** ModelBeacon catalog using schema version 1 or 2, with these top-level fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` for a reviewed snapshot; `2` also supports automated sync dates. |
| `revision` | `YYYY-MM-DD.N`, where `N` is 1–9999999 without leading zeros. The date matches `syncedAt` when present, otherwise `reviewedAt`. |
| `reviewedAt` | Actual human review date, `YYYY-MM-DD`. Do not update it merely because a download succeeded. |
| `syncedAt` | Optional in v2: the date factual data was synchronized, no earlier than `reviewedAt`. |
| `sources` | Source records with unique `id`, `title`, HTTPS `url`, `license`, HTTPS `licenseUrl`, and `retrievedAt`. |
| `models` | Model records with unique `id`, `name`, `provider`, `aliases`, `facts`, and `guidance`. Empty arrays are valid when information is unavailable. |
| `benchmarks` | Sourced benchmark observations, or `[]` when none are available. |

Every fact and guidance item, price table, and benchmark observation must reference a source ID defined in the same catalog. Benchmark model IDs must also exist in that catalog. Files cannot borrow base-catalog source or model IDs without defining them. Source links must use HTTPS without embedded credentials. Data is validated before it is appended.

Model `aliases` describe reviewed Copilot runtime IDs with an optional exact `version`. Leave them empty unless you have verified the mapping; names and API IDs are not interchangeable. Organization/custom providers remain distinct runtime identities and do not inherit Copilot evidence through these aliases. `guidance` can include the tasks `everyday`, `debugging`, `agentic`, and `visual`; each item needs a rationale, limitation, and source.

Optional `pricing` contains a `sourceId`, dated evidence, and one or more `tiers` with names and nonnegative USD rates per million input/output tokens. These are your source's published prices, not automatically Copilot rates. V1 requires `pricing.reviewedAt`. V2 accepts `pricing.syncedAt` instead, or both dates when accurate; at least one is required. `validThrough` hides expired pricing.

The complete field contract is in [src/types.ts](../src/types.ts), with validation in [src/core.ts](../src/core.ts). To validate an edited example locally:

```sh
npm run catalog:check -- docs/example-catalog.json
```

## Appending and conflicts

The base catalog wins, followed by extra catalogs in the order you added them. A model is skipped if its ID already exists or one of its aliases overlaps an existing alias. For example, an unversioned alias conflicts with every version of that ID; two aliases restricted to different exact versions can coexist. Duplicate identities inside one input catalog are invalid rather than silently removed.

Source IDs and benchmark IDs are scoped to the added catalog. Benchmark comparison groups are also isolated: an identical group name in two catalogs cannot make unrelated observations appear in a shared comparison chart. Only observations for successfully appended models are included. Removing an earlier catalog can make previously skipped entries from a later catalog visible.

Catalog observations must identify their benchmark and version, agent and version, reasoning effort, accuracy, positive trial count, and source. Preserve available evaluation dates and uncertainty; set a comparison group only after reviewing compatible configurations. ModelBeacon displays this evidence but does not run benchmarks or verify a publisher's claims. An added catalog does not make external results equivalent to your deployed model, and an absent result stays unavailable.
