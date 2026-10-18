import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml, stringify } from 'yaml';
import { parseCatalog } from '../src/core.ts';
import { fetchPreviousCatalog, fetchUpstream, syncCatalog, UPSTREAM_FILES } from '../scripts/catalog-sync.mts';
import type { UpstreamBundle } from '../scripts/catalog-sync.mts';

const base = parseCatalog(JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8')));
const originalBase = JSON.stringify(base);
const bundle: UpstreamBundle = {
  sha: 'dae83f7d28f3b8e10015bd6b6d8b72267cedceca',
  files: Object.fromEntries(await Promise.all(Object.entries(UPSTREAM_FILES).map(async ([key, path]) =>
    [key, await readFile(new URL(`fixtures/github-docs/${path.split('/').pop()}`, import.meta.url), 'utf8')]))) as UpstreamBundle['files'],
};
const TODAY = '2026-10-18';

test('real pinned GitHub snapshot synchronizes facts, restrictions and prices without claiming human review', () => {
  const result = syncCatalog(base, bundle, TODAY);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.reviewedAt, base.reviewedAt);
  assert.equal(result.syncedAt, TODAY);
  assert.equal(result.models.length, 31);
  assert(!result.models.some(model => model.name === 'GPT-5.4 nano'));
  const sol = result.models.find(model => model.name === 'GPT-6.1 Sol')!;
  assert.match(sol.facts.map(fact => fact.text).join(' '), /VS Code support is not specified/);
  assert.deepEqual(sol.guidance, base.models.find(model => model.id === sol.id)!.guidance);
  assert.deepEqual(sol.aliases, base.models.find(model => model.id === sol.id)!.aliases);
  assert.equal(sol.pricing!.reviewedAt, undefined);
  assert.equal(sol.pricing!.syncedAt, TODAY);
  assert.equal(sol.pricing!.tiers[1].cacheWriteUsdPerMillion, 5);
  assert.equal(sol.pricing!.tiers[1].threshold, '> 272K input tokens');
  assert.match(result.models.find(model => model.name === 'Claude Sonnet 4.6')!.facts.map(fact => fact.text).join(' '), /not available to subscribers on monthly plans/);
  assert.match(result.models.find(model => model.name === 'Claude Fable 5.1')!.facts.map(fact => fact.text).join(' '), /may not make the model endpoints or outputs available externally/);
  assert.equal(result.models.find(model => model.name === 'Gemini 4 Argon')!.pricing!.validThrough, '2026-11-30');
  assert.equal(result.models.find(model => model.name === 'Gemini 3.8 Flash')!.pricing!.validThrough, '2026-12-31');
  assert(result.sources.filter(source => source.id.startsWith('github-sync-')).every(source => source.url.includes(bundle.sha) && source.revision === bundle.sha));
  assert.equal(JSON.stringify(base), originalBase, 'Bundled curated snapshot must not be mutated');
});

test('new names get no guessed aliases, missing fields stay unknown, removed models disappear', () => {
  const changed = structuredClone(bundle);
  const releases = parseYaml(changed.files.releases) as Record<string, unknown>[];
  changed.files.releases = stringify([...releases.filter(row => row.name !== 'GPT-6.1 Sol'), { name: 'Example New Model', provider: 'Example', release_status: 'Public preview' }]);
  const result = syncCatalog(base, changed, TODAY);
  assert(!result.models.some(model => model.name === 'GPT-6.1 Sol'));
  const model = result.models.find(model => model.name === 'Example New Model')!;
  assert.deepEqual(model.aliases, []);
  assert.deepEqual(model.guidance, []);
  assert.equal(model.pricing, undefined);
  assert.match(model.facts.map(fact => fact.text).join(' '), /Plan availability is not specified/);
  assert.deepEqual(syncCatalog(base, changed, TODAY, result), result);
});

test('same-day retries are idempotent and changes advance the published sequence without rollback', () => {
  const previous = syncCatalog(base, bundle, TODAY);
  previous.revision = TODAY + '.17';
  assert.equal(syncCatalog(base, bundle, TODAY, previous).revision, TODAY + '.17');
  const changed = structuredClone(bundle);
  changed.files.prices = changed.files.prices.replace('input: $0.25', 'input: $0.26');
  assert.equal(syncCatalog(base, changed, TODAY, previous).revision, TODAY + '.18');
  assert.equal(syncCatalog(base, bundle, '2026-10-19', previous).revision, '2026-10-19.1');
  assert.throws(() => syncCatalog(base, bundle, '2026-10-17', previous), /future-dated/);
  assert.equal(syncCatalog(base, bundle, base.reviewedAt).revision, base.reviewedAt + '.3');
});

test('explicit VS Code removal is respected and stale rates disappear when upstream stops publishing them', () => {
  const changed = structuredClone(bundle);
  const clients = parseYaml(changed.files.clients) as Record<string, unknown>[];
  clients.find(row => row.name === 'GPT-5 mini')!.vscode = false;
  changed.files.clients = stringify(clients);
  changed.files.prices = stringify((parseYaml(changed.files.prices) as Record<string, unknown>[]).filter(row => row.model !== 'GPT-6.1 Sol'));
  const result = syncCatalog(base, changed, TODAY);
  assert(!result.models.some(model => model.name === 'GPT-5 mini'));
  assert.equal(result.models.find(model => model.name === 'GPT-6.1 Sol')!.pricing, undefined);
});

test('pricing providers compare normalized case without conflating different providers', () => {
  const changed = structuredClone(bundle);
  changed.files.prices = changed.files.prices.replaceAll('provider: openai', 'provider: OpenAI');
  assert.equal(syncCatalog(base, changed, TODAY).models.length, 31);
  changed.files.prices = changed.files.prices.replaceAll('provider: OpenAI', 'provider: Example');
  assert.throws(() => syncCatalog(base, changed, TODAY), /provider mismatch/);
});

test('upstream fetch pins every file to one SHA and never forwards the API token to raw hosts', async context => {
  const savedToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-only-token';
  context.after(() => {
    if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedToken;
  });
  const calls: { url: string; options?: RequestInit }[] = [];
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    calls.push({ url, options });
    if (url === 'https://api.github.com/repos/github/docs/commits/main') return new Response(JSON.stringify({ sha: bundle.sha }));
    const entry = Object.entries(UPSTREAM_FILES).find(([, path]) => url === `https://raw.githubusercontent.com/github/docs/${bundle.sha}/${path}`);
    assert(entry, `Unexpected source URL: ${url}`);
    return new Response(bundle.files[entry[0] as keyof typeof UPSTREAM_FILES]);
  });
  assert.deepEqual(await fetchUpstream(), bundle);
  assert.equal(calls.length, Object.keys(UPSTREAM_FILES).length + 1);
  assert.equal(new Headers(calls[0].options?.headers).get('Authorization'), 'Bearer test-only-token');
  assert(calls.slice(1).every(call => !new Headers(call.options?.headers).has('Authorization')));
  assert(calls.every(call => call.options?.redirect === 'error' && call.options?.credentials === 'omit'));
});

test('previous deployment accepts only valid catalogs or initial 404; failures never reset revision history', async context => {
  let response = new Response(null, { status: 404 });
  context.mock.method(globalThis, 'fetch', async () => response);
  const url = 'https://example.org/catalog/v2.json';
  assert.equal(await fetchPreviousCatalog(url), undefined);
  response = new Response(JSON.stringify(syncCatalog(base, bundle, TODAY)));
  assert.equal((await fetchPreviousCatalog(url))!.revision, TODAY + '.1');
  for (const invalid of [new Response(null, { status: 503 }), new Response('{broken'), new Response('{}'), new Response(' '.repeat(2_000_001))]) {
    response = invalid;
    await assert.rejects(() => fetchPreviousCatalog(url));
  }
  await assert.rejects(() => fetchPreviousCatalog('http://example.org/catalog/v2.json'), /HTTPS/);
});

test('unsafe or incomplete upstream changes abort instead of publishing plausible-looking data', () => {
  const changes: ((copy: UpstreamBundle) => void)[] = [
    copy => { copy.files.releases += '\n- name: Unknown\n  provider: Example\n  release_status: GA\n  restriction: private\n'; },
    copy => { copy.files.plans = copy.files.plans.replace('pro: true', 'pro: maybe'); },
    copy => { copy.files.prices = copy.files.prices.replace('input: $0.25', 'input: €0.25'); },
    copy => { copy.files.prices = copy.files.prices.replace("threshold: '> 272K'", "threshold: '> 999K'"); },
    copy => { copy.files.prices = copy.files.prices.replace('input: $0.75\n  cached_input: $0.075\n  output: $3.75', 'input: $0.80\n  cached_input: $0.075\n  output: $3.75'); },
    copy => { copy.files.terms = copy.files.terms.replace('through December 31, 2026.', 'for eligible customers only.'); },
    copy => { copy.files.terms = copy.files.terms.replace('**per 1 million tokens**', '**per 1 thousand tokens**'); },
    copy => { copy.files.supported = copy.files.supported.replace("model.name == 'GPT-5.4 nano'", "model.name contains 'GPT-5.4 nano'"); },
    copy => { copy.files.supported = copy.files.supported.replace('| Model | 1 million token context window |', '| Model | 2 million token context window |'); },
    copy => { copy.files.releases = '[]'; },
    copy => { copy.sha = 'main'; },
  ];
  for (const change of changes) {
    const changed = structuredClone(bundle);
    change(changed);
    assert.throws(() => syncCatalog(base, changed, TODAY));
  }
});
