import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { compareCatalogRevision, isSafeExternalUrl, parseCatalog } from '../src/core.ts';
import type { Catalog, CatalogModel, PriceTier } from '../src/types.ts';

export const UPSTREAM_FILES = {
  releases: 'data/tables/copilot/model-release-status.yml',
  plans: 'data/tables/copilot/model-supported-plans.yml',
  clients: 'data/tables/copilot/model-supported-clients.yml',
  retirements: 'data/tables/copilot/model-deprecation-history.yml',
  prices: 'data/tables/copilot/models-and-pricing.yml',
  supported: 'content/copilot/reference/ai-models/supported-models.md',
  terms: 'content/copilot/reference/copilot-billing/models-and-pricing.md',
  planTerms: 'data/reusables/copilot/available-models-per-plan.md',
  contextTerms: 'data/reusables/copilot/extended-context-pricing.md',
  copilot: 'data/variables/copilot.yml',
  product: 'data/variables/product.yml',
} as const;
export type UpstreamBundle = { sha: string; files: Record<keyof typeof UPSTREAM_FILES, string> };
type Row = Record<string, unknown>;
const PREFIX = 'github-sync-';
const PLAN_NAMES = { pro: 'Pro', pro_plus: 'Pro+', max: 'Max', business: 'Business', enterprise: 'Enterprise' };

function text(value: unknown): string {
  assert(typeof value === 'string' && value.trim() && value.length <= 4_000, 'Expected nonempty source text');
  return value;
}

function rows(input: string, required: string[], optional: string[] = []): Row[] {
  const parsed: unknown = parseYaml(input, { maxAliasCount: 0 });
  assert(Array.isArray(parsed) && parsed.length > 0 && parsed.length <= 1_000, 'Expected a nonempty upstream table');
  return parsed.map(value => {
    assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected a table row');
    assert(required.every(key => Object.hasOwn(value, key)), 'Missing upstream table field');
    assert(Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'Unknown upstream table field');
    return value as Row;
  });
}

function indexed(input: Row[], key = 'name'): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const row of input) {
    const name = text(row[key]);
    assert(!result.has(name), `Duplicate upstream model: ${name}`);
    result.set(name, row);
  }
  return result;
}

function date(value: string): string {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value, 'Invalid source date');
  return value;
}

function money(value: unknown): number {
  assert(typeof value === 'string' && /^\$\d+(?:\.\d+)?$/.test(value), 'Unknown price or currency');
  const number = Number(value.slice(1));
  assert(Number.isFinite(number), 'Invalid price');
  return number;
}

/** Translate only documented structured fields; unsupported source formats abort publication. */
export function syncCatalog(base: Catalog, bundle: UpstreamBundle, today: string, previous?: Catalog): Catalog {
  parseCatalog(base);
  if (previous) parseCatalog(previous);
  date(today);
  assert(/^[a-f0-9]{40}$/.test(bundle.sha), 'Expected an immutable GitHub commit SHA');
  const { files, sha } = bundle;
  const variables: Record<string, Row> = { copilot: parseYaml(files.copilot), product: parseYaml(files.product) };
  function expand(input: string): string {
    let result = input;
    for (let i = 0; i < 5 && /{% data variables\./.test(result); i++) {
      result = result.replace(/{% data variables\.(copilot|product)\.([a-zA-Z0-9_]+) %}/g,
        (_match, group: string, key: string) => text(variables[group]?.[key]));
    }
    assert(!/{[{%]|[%}]}/.test(result), 'Unsupported source template');
    return result.replace(/\[AUTOTITLE\]\((\/[^)]+)\)/g, 'GitHub documentation (https://docs.github.com/en$1)');
  }
  const releaseRows = rows(files.releases, ['name', 'provider', 'release_status']);
  const releases = indexed(releaseRows);
  const planRows = rows(files.plans, ['name', ...Object.keys(PLAN_NAMES)]);
  const clientRows = rows(files.clients, ['name', 'dotcom', 'cli', 'vscode', 'vs', 'eclipse', 'xcode', 'jetbrains']);
  for (const row of [...planRows, ...clientRows]) {
    assert(Object.entries(row).every(([key, value]) => key === 'name' || typeof value === 'boolean'), 'Unknown availability value');
  }
  const plans = indexed(planRows);
  const clients = indexed(clientRows);
  const retirements = indexed(rows(files.retirements, ['name', 'retirement_date', 'suggested_alternative']));
  for (const retirement of retirements.values()) date(text(retirement.retirement_date));
  const footnotes = new Map<string, { body: string; sourceId: string }>();
  for (const key of ['supported', 'planTerms', 'terms'] as const) {
    for (const match of files[key].matchAll(/^\[\^([^\]]+)\]: ([^\n]+(?:\n[ \t]+[^\n]+)*)/gm)) {
      assert(!footnotes.has(match[1]), `Duplicate footnote: ${match[1]}`);
      footnotes.set(match[1], { body: expand(match[2].replace(/\s+/g, ' ')), sourceId: PREFIX + key });
    }
  }
  const restrictions = new Map<string, { text: string; sourceId: string }[]>();
  for (const key of ['supported', 'planTerms'] as const) {
    const cells = [...files[key].matchAll(/^\| \{\{ model\.name \}\}([^|]*)\|/gm)];
    assert(cells.length > 0, 'Missing model restriction table');
    for (const cell of cells) {
      const remaining = cell[1].replace(/{% if (.*?) %}\[\^([^\]]+)\]{% endif %}/g, (_match, condition: string, id: string) => {
        const note = footnotes.get(id);
        assert(note, `Undefined restriction footnote: ${id}`);
        for (const part of condition.split(' or ')) {
          const name = /^model\.name == '([^']+)'$/.exec(part)?.[1];
          assert(name, 'Unsupported model restriction condition');
          const values = restrictions.get(name) ?? [];
          if (!values.some(value => value.text === note.body)) values.push({ text: note.body, sourceId: note.sourceId });
          restrictions.set(name, values);
        }
        return '';
      });
      assert(!remaining.trim(), 'Unrecognized model restriction syntax');
    }
  }
  const capabilitySection = files.supported.split('## Models with extended capabilities\n')[1]?.split('\n## ')[0];
  assert(capabilitySection?.includes('| Model | 1 million token context window | Configurable reasoning |'), 'Unknown capability table');
  const capabilities = new Map<string, string>();
  for (const line of capabilitySection.split('\n').filter(line => line.startsWith('| {% data '))) {
    const match = /^\| ({% data variables\.copilot\.[a-zA-Z0-9_]+ %}) \| {% octicon "(check|x)" aria-label="(?:Not supported|Supported)" %} \| {% octicon "(check|x)" aria-label="(?:Not supported|Supported)" %} \|$/.exec(line);
    assert(match, 'Unknown capability row');
    const name = expand(match[1]);
    assert(!capabilities.has(name), 'Duplicate capability model');
    capabilities.set(name, `GitHub lists optional 1 million token context: ${match[2] === 'check' ? 'supported' : 'not supported'}; configurable reasoning: ${match[3] === 'check' ? 'supported' : 'not supported'}. Configuration affects token use and pricing; this is not the current API input limit.`);
  }
  assert(capabilities.size > 0, 'Missing capability rows');
  assert(files.terms.includes('All prices are **per 1 million tokens**.'), 'Unknown pricing units');
  assert(files.terms.includes('**request-based billing**'), 'Missing annual-plan billing distinction');
  assert(files.contextTerms.includes('**Long context** tier'), 'Unknown extended-context pricing terms');
  const priceRows = rows(files.prices, ['model', 'provider', 'release_status', 'category', 'input', 'cached_input', 'output'],
    ['threshold', 'tier', 'cache_write']);
  const prices = new Map<string, { tiers: PriceTier[]; validThrough?: string; notes: { text: string; sourceId: string }[]; provider: string }>();
  for (const row of priceRows) {
    const match = /^([^\[]+)(?:\[\^([^\]]+)\])?$/.exec(text(row.model));
    assert(match, 'Unknown pricing model name or footnote');
    const name = match[1];
    assert(['GA', 'Public preview'].includes(text(row.release_status)), 'Unknown pricing release status');
    text(row.category);
    const price = prices.get(name) ?? { tiers: [], notes: [], provider: text(row.provider) };
    assert(price.provider === row.provider, 'Conflicting pricing providers');
    const tier: PriceTier = { name: row.tier === undefined ? 'Default' : text(row.tier), inputUsdPerMillion: money(row.input), outputUsdPerMillion: money(row.output) };
    if (row.cached_input !== 'Not applicable') tier.cachedInputUsdPerMillion = money(row.cached_input);
    if (row.cache_write !== undefined && row.cache_write !== 'Not applicable') tier.cacheWriteUsdPerMillion = money(row.cache_write);
    if (row.threshold !== undefined && row.threshold !== 'Not applicable') {
      assert(/^(≤|>) \d+(?:\.\d+)?[KM]$/.test(text(row.threshold)), 'Unknown pricing threshold');
      tier.threshold = `${row.threshold} input tokens`;
    }
    assert(!price.tiers.some(existing => existing.name === tier.name), 'Duplicate pricing tier');
    price.tiers.push(tier);
    if (match[2]) {
      const note = footnotes.get(match[2]);
      assert(note, 'Undefined pricing footnote');
      const promo = /^.+ (?:is|are) available at the promotional pricing of (\$[\d.]+) per 1M input tokens, (\$[\d.]+) per 1M cached input tokens, and (\$[\d.]+) per 1M output tokens (through|until) ([A-Za-z]+ \d{1,2}, \d{4})\.$/.exec(note.body);
      assert(promo, 'Unsupported pricing condition; review the importer before publishing');
      assert(money(promo[1]) === tier.inputUsdPerMillion && money(promo[2]) === tier.cachedInputUsdPerMillion && money(promo[3]) === tier.outputUsdPerMillion, 'Promotion and pricing table disagree');
      const expiry = new Date(promo[5] + ' UTC');
      assert(Number.isFinite(expiry.getTime()), 'Invalid promotion end date');
      if (promo[4] === 'until') expiry.setUTCDate(expiry.getUTCDate() - 1);
      const validThrough = expiry.toISOString().slice(0, 10);
      assert(price.validThrough === undefined || price.validThrough === validThrough, 'Conflicting promotion dates');
      price.validThrough = validThrough;
      if (!price.notes.some(value => value.text === note.body)) price.notes.push({ text: note.body, sourceId: note.sourceId });
    }
    prices.set(name, price);
  }
  for (const price of prices.values()) {
    if (price.tiers.length === 1) assert(!price.tiers[0].threshold, 'Incomplete long-context prices');
    else {
      assert(price.tiers.length === 2, 'Unsupported pricing tier structure');
      const lower = price.tiers.find(tier => tier.name === 'Default');
      const upper = price.tiers.find(tier => tier.name === 'Long context');
      assert(lower?.threshold?.startsWith('≤ ') && upper?.threshold === lower.threshold.replace('≤', '>'), 'Incomplete or overlapping pricing thresholds');
    }
  }
  const curated = new Map(base.models.map(model => [model.name, model]));
  const models: CatalogModel[] = [];
  for (const [name, release] of releases) {
    const plan = plans.get(name);
    const client = clients.get(name);
    const notes = restrictions.get(name) ?? [];
    if (client?.vscode === false || notes.some(note => /is not available in Copilot Chat/.test(note.text))) continue;
    assert(['GA', 'Public preview'].includes(text(release.release_status)), 'Unknown release status');
    const provider = text(release.provider);
    const old = curated.get(name);
    assert(!old || old.provider === provider, `Provider changed for curated model: ${name}`);
    const model: CatalogModel = old ? structuredClone(old) : {
      id: `github:${provider}:${name}`.toLowerCase().replace(/[^a-z0-9:.]+/g, '-'), name, provider, aliases: [], facts: [], guidance: [],
    };
    model.facts = model.facts.filter(fact => !['github-model-list', 'github-plan-access', 'github-supported', 'github-pricing-terms'].includes(fact.sourceId));
    model.facts.unshift({ text: `GitHub lists release status ${release.release_status}. Public listing does not establish access in your account.`, sourceId: PREFIX + 'releases' });
    model.facts.push({ text: client ? 'GitHub lists VS Code support; actual access depends on your account and client version.' : 'VS Code support is not specified in the current GitHub client table.', sourceId: PREFIX + 'clients' });
    model.facts.push({ text: plan ? `GitHub lists these paid plans: ${Object.entries(PLAN_NAMES).filter(([key]) => plan[key]).map(([, label]) => label).join(', ') || 'none'}. Model restrictions and administrator policies still apply; Free and Student plans use automatic model selection.` : 'Plan availability is not specified in the current GitHub plan table.', sourceId: PREFIX + 'plans' }, ...notes);
    const capability = capabilities.get(name);
    if (capability) model.facts.push({ text: capability, sourceId: PREFIX + 'supported' });
    const retirement = retirements.get(name);
    if (retirement) model.facts.push({ text: `GitHub records retirement on ${retirement.retirement_date}; any remaining availability is subject to the exceptions above.`, sourceId: PREFIX + 'retirements' });
    delete model.pricing;
    const price = prices.get(name);
    if (price) {
      assert(price.provider.toLowerCase().replace(/[^a-z]/g, '') === provider.toLowerCase().replace(/[^a-z]/g, ''), `Pricing provider mismatch: ${name}`);
      model.pricing = { sourceId: PREFIX + 'prices', syncedAt: today, tiers: price.tiers, ...(price.validThrough ? { validThrough: price.validThrough } : {}) };
      model.facts.push(...price.notes, { text: 'These are Copilot USD token rates, not account usage or a bill estimate. Existing annual request-based plans use different model multipliers; see the billing terms.', sourceId: PREFIX + 'terms' });
    }
    models.push(model);
  }
  assert(models.length > 0, 'Refusing to publish an empty model catalog');
  const order = new Map(base.models.map((model, index) => [model.id, index]));
  models.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.name.localeCompare(b.name, 'en'));
  const ids = new Set(models.map(model => model.id));
  const sources = Object.entries(UPSTREAM_FILES).map(([id, path]) => ({
    id: PREFIX + id, title: `GitHub Docs: ${path.split('/').pop()} (automatically synchronized)`,
    url: `https://github.com/github/docs/blob/${sha}/${path}`, license: 'CC-BY-4.0',
    licenseUrl: `https://github.com/github/docs/blob/${sha}/LICENSE`, retrievedAt: today, revision: sha,
  }));
  const candidate: Catalog = { ...structuredClone(base), schemaVersion: 2, syncedAt: today,
    sources: [...base.sources, ...sources], models, benchmarks: base.benchmarks.filter(row => ids.has(row.modelId)) };
  const newest = previous && compareCatalogRevision(previous, base) > 0 ? previous : base;
  assert(newest.revision.slice(0, 10) <= today, 'Refusing to overwrite a future-dated published catalog');
  candidate.revision = previous?.revision ?? base.revision;
  if (previous && JSON.stringify(candidate) === JSON.stringify(previous)) return previous;
  candidate.revision = `${today}.${newest.revision.startsWith(today + '.') ? Number(newest.revision.slice(11)) + 1 : 1}`;
  return parseCatalog(candidate);
}

async function download(url: string, allowMissing = false, headers: Record<string, string> = {}): Promise<string | undefined> {
  assert(isSafeExternalUrl(url), 'Expected an HTTPS URL without credentials');
  const response = await fetch(url, { headers, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (allowMissing && response.status === 404) return undefined;
  assert(response.ok, `Download failed (${response.status}): ${url}`);
  assert(response.body, 'Empty upstream response');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    length += chunk.length;
    assert(length <= 2_000_000, 'Upstream response exceeds 2 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchUpstream(): Promise<UpstreamBundle> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const commit = JSON.parse((await download('https://api.github.com/repos/github/docs/commits/main', false, headers))!);
  assert(typeof commit.sha === 'string' && /^[a-f0-9]{40}$/.test(commit.sha), 'Invalid upstream commit');
  const files = await Promise.all(Object.entries(UPSTREAM_FILES).map(async ([key, path]) =>
    [key, await download(`https://raw.githubusercontent.com/github/docs/${commit.sha}/${path}`)]));
  return { sha: commit.sha, files: Object.fromEntries(files) as UpstreamBundle['files'] };
}

export async function fetchPreviousCatalog(url: string): Promise<Catalog | undefined> {
  const previous = await download(url, true);
  return previous === undefined ? undefined : parseCatalog(JSON.parse(previous));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = process.argv[2] ?? 'artifacts/site/catalog/v2.json';
  const previousUrl = process.argv[3];
  const base = parseCatalog(JSON.parse(await readFile('data/catalog.json', 'utf8')));
  const previous = previousUrl ? await fetchPreviousCatalog(previousUrl) : undefined;
  const bundle = await fetchUpstream();
  const catalog = syncCatalog(base, bundle, new Date().toISOString().slice(0, 10), previous);
  const serialized = JSON.stringify(catalog, null, 2) + '\n';
  assert(Buffer.byteLength(serialized) <= 2_000_000, 'Catalog exceeds 2 MB');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serialized);
  console.log(`Synced github/docs@${bundle.sha}: ${catalog.models.length} models, catalog ${catalog.revision} → ${output}`);
}
