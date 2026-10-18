import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExtraCatalogStore } from '../src/extra-catalog-store.ts';
import type { CatalogStorage } from '../src/catalog-store.ts';
import type { Catalog, CatalogModel } from '../src/types.ts';
import { parseCatalog } from '../src/core.ts';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const URL = 'https://example.org/catalog.json?token=private';
const model = (id: string, aliases: CatalogModel['aliases'] = [{ id }]): CatalogModel => ({ id, name: id, provider: 'Example', aliases,
  facts: [{ text: 'An independently maintained model.', sourceId: 'source' }],
  guidance: [{ task: 'agentic', rationale: 'Example', limitation: 'Example limitation', sourceId: 'source' }],
  pricing: { sourceId: 'source', reviewedAt: '2026-10-17', tiers: [{ name: 'Standard', inputUsdPerMillion: 1, outputUsdPerMillion: 2 }] },
});
const catalog = (...models: CatalogModel[]): Catalog => ({ schemaVersion: 1, revision: '2026-10-17.1', reviewedAt: '2026-10-17',
  sources: [{ id: 'source', title: 'Example source', url: 'https://example.org/models', license: 'CC0', licenseUrl: 'https://example.org/license', retrievedAt: '2026-10-17' }],
  models, benchmarks: models.map(entry => ({ id: entry.id, modelId: entry.id, benchmark: 'Example benchmark', benchmarkVersion: '1', agent: 'Example', agentVersion: '1', reasoningEffort: 'high', accuracy: 80, trials: 3, sourceId: 'source', comparisonGroup: 'same-group' })),
});
function storage(initial?: unknown): CatalogStorage & { value: unknown } {
  return { value: initial, get<T>() { return this.value as T | undefined; }, async update(_key, value) { this.value = value; } };
}
const response = (data = catalog(model('custom')), etag = 'v1') => new Response(JSON.stringify(data), { headers: { etag } });

test('file catalogs append without changing the base or sharing benchmark namespaces', async () => {
  const disk = storage();
  const store = new ExtraCatalogStore(disk, async () => { throw new Error('Must stay offline'); }, () => NOW);
  const base = catalog(model('base'));
  const baseBefore = structuredClone(base);
  await store.addFile('/path/company.json', JSON.stringify(catalog(model('one'), model('two'))));
  await store.addFile('another.json', JSON.stringify(catalog(model('three'))));
  const { catalog: merged, entries } = store.view(base);
  assert.deepEqual(base, baseBefore);
  assert.deepEqual(merged.models.map(entry => entry.id), ['base', 'one', 'two', 'three']);
  assert.equal(merged.models[1].catalogLabel, 'company.json');
  assert.equal(merged.models[1].catalogReviewedAt, '2026-10-17');
  assert.equal(merged.sources.length, 3);
  assert.notEqual(merged.models[1].facts[0].sourceId, 'source');
  assert.equal(merged.models[1].facts[0].sourceId, merged.models[1].guidance[0].sourceId);
  assert.equal(merged.models[1].pricing?.sourceId, merged.models[1].facts[0].sourceId);
  assert.equal(merged.benchmarks[1].comparisonGroup, merged.benchmarks[2].comparisonGroup);
  assert.notEqual(merged.benchmarks[0].comparisonGroup, merged.benchmarks[1].comparisonGroup);
  assert.notEqual(merged.benchmarks[2].comparisonGroup, merged.benchmarks[3].comparisonGroup);
  assert.doesNotThrow(() => parseCatalog(merged));
  assert.equal(entries[0].addedModelCount, 2);
  assert.equal(new ExtraCatalogStore(disk, fetch, () => NOW).view(base).entries.length, 2);
  await store.refresh(true);
  await store.remove(entries[0].id);
  assert.deepEqual(store.view(base).catalog.models.map(entry => entry.id), ['base', 'three']);
});

test('base and earlier extra catalogs win IDs and overlapping aliases, while distinct alias versions coexist', async () => {
  const store = new ExtraCatalogStore(storage(), fetch, () => NOW);
  const base = catalog(model('base'), model('versioned', [{ id: 'shared', version: '1' }]));
  const duplicates = catalog(model('base', []), model('alias-collision', [{ id: 'base' }]), model('specific', [{ id: 'shared', version: '2' }]), model('first'));
  await store.addFile('first.json', JSON.stringify(duplicates));
  await store.addFile('second.json', JSON.stringify(catalog(model('second', [{ id: 'first' }]), model('catch-all', [{ id: 'shared' }]), model('last'))));
  const { catalog: merged, entries } = store.view(base);
  assert.deepEqual(merged.models.map(entry => entry.id), ['base', 'versioned', 'specific', 'first', 'last']);
  assert.deepEqual(entries.map(entry => [entry.addedModelCount, entry.ignoredModelCount]), [[2, 2], [1, 2]]);
  assert.deepEqual(merged.benchmarks.map(entry => entry.modelId), ['base', 'versioned', 'specific', 'first', 'last']);
  assert.doesNotThrow(() => parseCatalog(merged));
  const upgradedBase = catalog(model('base'), model('versioned', [{ id: 'shared', version: '1' }]), model('first'));
  assert.equal(store.view(upgradedBase).entries[0].ignoredModelCount, 3);
});

test('schema 2 additions preserve their synchronization and review dates', async () => {
  const store = new ExtraCatalogStore(storage(), fetch, () => NOW);
  const extra: Catalog = { ...catalog(model('custom')), schemaVersion: 2, syncedAt: '2026-10-18', revision: '2026-10-18.1' };
  extra.models[0].pricing = { ...extra.models[0].pricing!, reviewedAt: undefined, syncedAt: '2026-10-18' };
  await store.addFile('automated.json', JSON.stringify(extra));
  const { catalog: merged, entries } = store.view(catalog(model('base')));
  assert.equal(merged.schemaVersion, 2);
  assert.equal(merged.reviewedAt, '2026-10-17');
  assert.equal(merged.models[1].catalogReviewedAt, '2026-10-17');
  assert.equal(entries[0].syncedAt, '2026-10-18');
  assert.doesNotThrow(() => parseCatalog(merged));
});

test('URL catalogs refresh daily, keep ETags and omit URLs from UI summaries', async () => {
  const disk = storage();
  let now = NOW;
  const calls: { url: unknown; options?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? response() : new Response(null, { status: 304 });
  };
  const store = new ExtraCatalogStore(disk, fetcher, () => now);
  await store.addUrl(URL + '#ignored');
  assert.equal(calls[0].url, URL);
  assert.equal(calls[0].options?.redirect, 'error');
  assert.equal(calls[0].options?.credentials, 'omit');
  assert.ok(calls[0].options?.signal);
  await store.refresh();
  assert.equal(calls.length, 1);
  await store.refresh(true);
  assert.deepEqual(calls[1].options?.headers, { 'If-None-Match': 'v1' });
  const summaries = store.view(catalog()).entries;
  assert.equal(summaries[0].label, 'example.org');
  assert.ok(!JSON.stringify(summaries).includes('private'));
  const restored = new ExtraCatalogStore(disk, fetcher, () => now);
  await restored.refresh();
  assert.equal(calls.length, 2);
  now += 86_400_001;
  await restored.refresh();
  assert.equal(calls.length, 3);
});

test('bad URL schemes, credentials, duplicate catalogs and capacity fail without replacing existing entries', async () => {
  let requests = 0;
  const store = new ExtraCatalogStore(storage(), async () => { requests++; return response(); }, () => NOW);
  for (const url of ['http://example.org/a', 'https://user:secret@example.org/a', 'file:///tmp/file.json']) {
    await assert.rejects(store.addUrl(url), /HTTPS without credentials/);
  }
  assert.equal(requests, 0);
  await store.addUrl(URL);
  await assert.rejects(store.addUrl(URL + '#fragment'), /already added/);
  for (let index = 0; index < 9; index++) await store.addFile(`file-${index}.json`, JSON.stringify(catalog()));
  await assert.rejects(store.addFile('file-0.json', JSON.stringify(catalog())), /already added/);
  await assert.rejects(store.addFile('overflow.json', JSON.stringify(catalog())), /Up to 10/);
  assert.equal(store.view(catalog()).entries.length, 10);
  assert.equal(requests, 1);
});

test('invalid, oversized, redirected and future downloads never become entries or expose request secrets', async () => {
  const fetchers: typeof fetch[] = [
    async () => new Response('not json'),
    async () => response({ ...catalog(), schemaVersion: 3 } as unknown as Catalog),
    async () => response({ ...catalog(), revision: '2099-01-01.1', reviewedAt: '2099-01-01' }),
    async () => new Response('small', { headers: { 'content-length': '3000000' } }),
    async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    async () => new Response(null, { status: 302, headers: { location: 'http://other.example' } }),
    async () => new Response(null, { status: 304 }),
    async () => { throw new Error(`Unable to load ${URL}`); },
  ];
  for (const fetcher of fetchers) {
    const store = new ExtraCatalogStore(storage(), fetcher, () => NOW);
    await assert.rejects(store.addUrl(URL), error => error instanceof Error && /Could not add/.test(error.message) && !error.message.includes('private'));
    assert.equal(store.view(catalog()).entries.length, 0);
  }
  const store = new ExtraCatalogStore(storage(), fetch, () => NOW);
  await assert.rejects(store.addFile('invalid.json', 'no json'), /valid ModelBeacon/);
  await assert.rejects(store.addFile('large.json', 'x'.repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
});

test('failed and older refreshes preserve snapshots and throttle across restart', async () => {
  for (const failure of [() => { throw new Error(URL); }, () => response({ ...catalog(model('old')), revision: '2026-10-16.1', reviewedAt: '2026-10-16' }), () => new Response('invalid')]) {
    const disk = storage();
    let requests = 0;
    const fetcher: typeof fetch = async () => ++requests === 1 ? response() : failure();
    const store = new ExtraCatalogStore(disk, fetcher, () => NOW);
    await store.addUrl(URL);
    await store.refresh(true);
    const state = store.view(catalog());
    assert.equal(state.catalog.models[0].id, 'custom');
    assert.match(state.entries[0].message, /Keeping the last saved/);
    assert.ok(!state.entries[0].message.includes('private'));
    await new ExtraCatalogStore(disk, fetcher, () => NOW + 1_000).refresh();
    assert.equal(requests, 2);
  }
});

test('refresh moves to newer numeric revisions and shares concurrent work', async () => {
  let requests = 0;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const store = new ExtraCatalogStore(storage(), async () => {
    requests++;
    if (requests === 1) return response({ ...catalog(model('custom')), revision: '2026-10-17.9' });
    await gate;
    return response({ ...catalog(model('updated')), revision: '2026-10-17.10' });
  }, () => NOW);
  await store.addUrl(URL);
  const one = store.refresh(true);
  const two = store.refresh(true);
  finish();
  await Promise.all([one, two]);
  assert.equal(requests, 2);
  assert.equal(store.view(catalog()).catalog.models[0].id, 'updated');
});

test('removing a catalog during its download cannot resurrect it in memory or storage', async () => {
  const disk = storage();
  let requests = 0;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const store = new ExtraCatalogStore(disk, async () => { if (++requests > 1) await gate; return response(); }, () => NOW);
  await store.addUrl(URL);
  const refresh = store.refresh(true);
  await store.remove(store.view(catalog()).entries[0].id);
  finish();
  await refresh;
  assert.deepEqual(store.view(catalog()).entries, []);
  assert.deepEqual(new ExtraCatalogStore(disk, fetch, () => NOW).view(catalog()).entries, []);
});

test('corrupt cached entries are skipped without discarding other valid imports', async () => {
  const disk = storage();
  const store = new ExtraCatalogStore(disk, fetch, () => NOW);
  await store.addFile('valid.json', JSON.stringify(catalog(model('valid'))));
  const valid = structuredClone((disk.value as unknown[])[0]);
  disk.value = [valid, { ...(valid as object), id: 'bad-id' }, { ...(valid as object), id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', catalog: {} }];
  const restored = new ExtraCatalogStore(disk, fetch, () => NOW);
  assert.equal(restored.view(catalog()).entries.length, 1);
  assert.match(restored.message, /invalid/);
  assert.deepEqual(new ExtraCatalogStore(storage({ malformed: true })).view(catalog()).entries, []);
});

test('writes are serialized and persistence failure keeps session data usable', async () => {
  const disk = storage();
  let active = 0;
  disk.update = async (_key, value) => {
    assert.equal(active++, 0);
    await new Promise(resolve => setTimeout(resolve, 1));
    disk.value = value;
    active--;
  };
  const store = new ExtraCatalogStore(disk, fetch, () => NOW);
  await Promise.all([store.addFile('a.json', JSON.stringify(catalog(model('a')))), store.addFile('b.json', JSON.stringify(catalog(model('b'))))]);
  assert.equal(new ExtraCatalogStore(disk, fetch, () => NOW).view(catalog()).entries.length, 2);
  disk.update = async () => { throw new Error('Full disk'); };
  await store.remove(store.view(catalog()).entries[0].id);
  assert.equal(store.view(catalog()).entries.length, 1);
  assert.match(store.message, /could not be saved.*removed catalogs may return/);
});
