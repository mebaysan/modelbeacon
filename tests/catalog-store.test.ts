import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CatalogStore } from '../src/catalog-store.ts';
import { parseCatalog } from '../src/core.ts';
import type { CatalogStorage } from '../src/catalog-store.ts';
import type { Catalog } from '../src/types.ts';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const URL = 'https://example.org/catalog/v1.json';
const catalog: Catalog = { schemaVersion: 1, revision: '2026-10-16.1', reviewedAt: '2026-10-16', sources: [], models: [], benchmarks: [] };

function storage(initial?: unknown): CatalogStorage & { value: unknown } {
  return {
    value: initial,
    get<T>(): T | undefined { return this.value as T | undefined; },
    async update(_key, value) { this.value = value; },
  };
}

function response(data: unknown = { ...catalog, revision: '2026-10-17.1', reviewedAt: '2026-10-17' }, etag = 'v2'): Response {
  return new Response(JSON.stringify(data), { headers: { etag } });
}

test('unpublished builds stay fully offline', async () => {
  let requests = 0;
  const store = new CatalogStore(catalog, storage(), '', async () => { requests++; return response(); }, () => NOW);
  await store.refresh(true);
  assert.equal(requests, 0);
  assert.equal(store.origin, 'bundled');
  assert.match(store.message, /local build/);
});

test('valid download persists and daily checks throttle, manual refresh revalidates with ETag', async () => {
  const disk = storage();
  const calls: RequestInit[] = [];
  const store = new CatalogStore(catalog, disk, URL, async (_url, options) => {
    calls.push(options!);
    return calls.length === 1 ? response() : new Response(null, { status: 304 });
  }, () => NOW);
  await store.refresh();
  assert.equal(store.catalog.revision, '2026-10-17.1');
  assert.equal(store.origin, 'online');
  await store.refresh();
  assert.equal(calls.length, 1);
  await store.refresh(true);
  assert.deepEqual(calls[1].headers, { 'If-None-Match': 'v2' });
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].credentials, 'omit');
  const restored = new CatalogStore(catalog, disk, URL, async () => { throw new Error('offline'); }, () => NOW);
  assert.equal(restored.origin, 'cached');
  assert.equal(restored.catalog.revision, '2026-10-17.1');
});

test('invalid cache, wrong feed and older cache cannot replace the bundled catalog', () => {
  for (const cache of [
    { url: URL, catalog: { schemaVersion: 2 } },
    { url: 'https://other.example/catalog', catalog: { ...catalog, revision: '2026-10-16.9' } },
    { url: URL, catalog: { ...catalog, reviewedAt: '2026-01-01', revision: '2026-01-01.1' } },
  ]) {
    assert.equal(new CatalogStore(catalog, storage(cache), URL).catalog.revision, catalog.revision);
  }
});

test('the current bundle replaces previously cached benchmark results on upgrade', async () => {
  const bundled = parseCatalog(JSON.parse(await readFile(new globalThis.URL('../data/catalog.json', import.meta.url), 'utf8')));
  const previous = parseCatalog({ ...bundled, revision: '2026-10-17.1', benchmarks: [{
    id: 'legacy-score', modelId: bundled.models[0].id, benchmark: 'Legacy evaluation',
    benchmarkVersion: '1.0', agent: 'Test Agent', agentVersion: '1.0', reasoningEffort: 'high',
    accuracy: 50, trials: 5, sourceId: bundled.sources[0].id,
  }] });
  const disk = storage({ url: '', catalog: previous, etag: 'legacy', attemptedAt: NOW });
  const store = new CatalogStore(bundled, disk, '', async () => { throw new Error('Must stay offline'); }, () => NOW);
  await store.refresh(true);
  assert.equal(store.origin, 'bundled');
  assert.equal(store.catalog, bundled);
  assert.deepEqual(store.catalog.benchmarks, []);
  assert.ok(store.catalog.models.length > 0);
});

test('network, parse, schema, rollback and future-date failures preserve usable data', async () => {
  const fetchers: typeof fetch[] = [
    async () => { throw new Error('offline'); },
    async () => new Response('not json'),
    async () => response({ ...catalog, schemaVersion: 2 }),
    async () => response({ ...catalog, reviewedAt: '2025-01-01', revision: '2025-01-01.1' }),
    async () => response({ ...catalog, reviewedAt: '2099-01-01', revision: '2099-01-01.1' }),
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response(null, { status: 304 }),
  ];
  for (const fetcher of fetchers) {
    const store = new CatalogStore(catalog, storage(), URL, fetcher, () => NOW);
    await store.refresh();
    assert.equal(store.catalog.revision, catalog.revision);
    assert.match(store.message, /Keeping the bundled catalog/);
  }
});

test('oversized bodies are rejected even without a Content-Length header', async () => {
  for (const large of [new Response('x'.repeat(2 * 1024 * 1024 + 1)), new Response('small', { headers: { 'content-length': '3000000' } })]) {
    const store = new CatalogStore(catalog, storage(), URL, async () => large, () => NOW);
    await store.refresh();
    assert.equal(store.catalog.revision, catalog.revision);
    assert.match(store.message, /size limit/);
  }
});

test('simultaneous refresh requests share one download', async () => {
  let requests = 0;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const store = new CatalogStore(catalog, storage(), URL, async () => { requests++; await gate; return response(); }, () => NOW);
  const one = store.refresh(true);
  const two = store.refresh(true);
  finish();
  await Promise.all([one, two]);
  assert.equal(requests, 1);
});

test('persistence failure keeps online data available in memory', async () => {
  const disk = storage();
  disk.update = async () => { throw new Error('disk full'); };
  const store = new CatalogStore(catalog, disk, URL, async () => response(), () => NOW);
  await store.refresh();
  assert.equal(store.catalog.revision, '2026-10-17.1');
  assert.match(store.message, /could not be saved/);
});

test('cached attempt time throttles failed updates after restart', async () => {
  const disk = storage();
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; throw new Error('offline'); };
  await new CatalogStore(catalog, disk, URL, fetcher, () => NOW).refresh();
  await new CatalogStore(catalog, disk, URL, fetcher, () => NOW + 1_000).refresh();
  assert.equal(requests, 1);
  await new CatalogStore(catalog, disk, URL, fetcher, () => NOW + 86_400_001).refresh();
  assert.equal(requests, 2);
});

test('same-day updates advance numerically and old caches cannot mask a new bundle', async () => {
  const bundled = { ...catalog, revision: '2026-10-16.10' };
  const disk = storage({ url: URL, catalog: { ...catalog, revision: '2026-10-16.9' }, etag: 'older', attemptedAt: NOW });
  let requests = 0;
  const store = new CatalogStore(bundled, disk, URL, async (_url, options) => {
    requests++;
    assert.deepEqual(options?.headers, {});
    return response({ ...catalog, revision: '2026-10-16.11' });
  }, () => NOW);
  assert.equal(store.catalog.revision, '2026-10-16.10');
  await store.refresh();
  assert.equal(requests, 1);
  assert.equal(store.catalog.revision, '2026-10-16.11');
  const rollback = new CatalogStore(bundled, storage(), URL, async () => response({ ...catalog, revision: '2026-10-16.9' }), () => NOW);
  await rollback.refresh(true);
  assert.equal(rollback.catalog.revision, '2026-10-16.10');
  assert.match(rollback.message, /older than/);
});
