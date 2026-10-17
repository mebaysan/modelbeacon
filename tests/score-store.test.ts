import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoreStore } from '../src/score-store.ts';
import { parseScoreResponses } from '../src/scores.ts';
import type { CatalogStorage } from '../src/catalog-store.ts';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const DATE = new Date(NOW).toISOString();
const KEY = 'scoreCache.v1';
const row = { source: 'openrouter', model_permaslug: 'vendor/example-1', display_name: 'Example 1', benchmark_type: 'gpqa_diamond', accuracy: 0.72, total_tasks: 100, last_run_timestamp: DATE };
const payload = { data: [row], meta: { as_of: DATE } };
const saved = parseScoreResponses([payload], false, DATE);

function storage(initial?: unknown): CatalogStorage & { value: unknown; writes: unknown[] } {
  return { value: initial, writes: [],
    get<T>(key: string): T | undefined { assert.equal(key, KEY); return this.value as T | undefined; },
    async update(key, value) { assert.equal(key, KEY); this.value = structuredClone(value); this.writes.push(this.value); },
  };
}
function result(url: string | URL | Request): Response {
  const query = new URL(String(url)).searchParams;
  const data = query.get('source') === 'artificial-analysis'
    ? [{ source: 'artificial-analysis', model_permaslug: 'vendor/example-1', display_name: 'Example 1', intelligence_index: 70, coding_index: null }]
    : [{ ...row, benchmark_type: query.get('benchmark_type') }];
  return new Response(JSON.stringify({ data, meta: { as_of: DATE } }));
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('construction is offline, validates saved scores and strips unexpected cache fields', () => {
  let calls = 0;
  const store = new ScoreStore(storage({ ...saved, key: 'secret' }), async () => { calls++; throw new Error('network'); }, () => NOW);
  assert.equal(calls, 0);
  assert.deepEqual(store.snapshot, saved);
  assert.match(store.message, /saved on this device/);
  for (const cache of [null, {}, { ...saved, records: [{ ...saved.records[0], value: 101 }] }]) {
    const invalid = new ScoreStore(storage(cache));
    assert.equal(invalid.snapshot, undefined);
    assert.match(invalid.message, /could not be read/);
  }
});

test('refresh queries only fixed public benchmark endpoints with isolated credentials and caches allowlisted scores', async () => {
  const disk = storage();
  const calls: { url: string; options: RequestInit }[] = [];
  const store = new ScoreStore(disk, async (url, options) => { calls.push({ url: String(url), options: options! }); return result(url); }, () => NOW);
  await store.refresh('test-key', false);
  assert.equal(calls.length, 2);
  assert.deepEqual(store.snapshot?.records.map(score => score.metric), ['gpqa', 'toolUse']);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, 'https://openrouter.ai');
    assert.equal(new URL(call.url).pathname, '/api/v1/benchmarks');
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.body, undefined);
    assert.deepEqual(call.options.headers, { Authorization: 'Bearer test-key' });
    assert.ok(call.options.signal);
  }
  assert.deepEqual(disk.value, store.snapshot);
  assert.doesNotMatch(JSON.stringify(disk.value), /test-key|Authorization/);
  assert.deepEqual(new ScoreStore(disk).snapshot, store.snapshot);
  await store.refresh('test-key', true);
  assert.equal(calls.length, 5);
  assert.equal(store.snapshot?.includesComposites, true);
  assert.ok(store.snapshot?.records.some(score => score.metric === 'intelligence'));
});

test('simultaneous refreshes share a request batch', async () => {
  const gate = deferred();
  let calls = 0;
  const store = new ScoreStore(storage(), async url => { calls++; await gate.promise; return result(url); }, () => NOW);
  const first = store.refresh('test-key', false);
  const second = store.refresh('test-key', false);
  assert.equal(first, second);
  gate.release();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
});

test('partial, schema, oversized and offline failures preserve the whole previous snapshot without exposing server errors', async () => {
  const failures: typeof fetch[] = [
    async () => { throw new Error('test-key private-url'); },
    async () => new Response('{bad json'),
    async () => new Response(JSON.stringify({ ...payload, meta: { as_of: '2099-01-01T00:00:00Z' } })),
    async () => new Response(JSON.stringify({ ...payload, data: [{ ...row, accuracy: 5 }] })),
    async () => new Response('private error', { status: 500 }),
    async () => new Response('small', { headers: { 'content-length': '3000000' } }),
    async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  ];
  let calls = 0;
  failures.push(async url => { calls++; return calls === 1 ? result(url) : new Response('private failure', { status: 500 }); });
  for (const fetcher of failures) {
    const disk = storage(saved);
    const store = new ScoreStore(disk, fetcher, () => NOW);
    await store.refresh('test-key', false);
    assert.deepEqual(store.snapshot, saved);
    assert.deepEqual(disk.value, saved);
    assert.equal(disk.writes.length, 0);
    assert.match(store.message, /Keeping the previously saved scores/);
    assert.doesNotMatch(store.message, /test-key|private/);
  }
});

test('authentication and rate-limit failures give actionable messages without server-provided details', async () => {
  for (const status of [401, 403, 429]) {
    const store = new ScoreStore(storage(), async () => new Response('test-key', { status }), () => NOW);
    await store.refresh('test-key', false);
    assert.match(store.message, status === 429 ? /rate limit/ : /valid key/);
    assert.doesNotMatch(store.message, /test-key/);
    assert.equal(store.snapshot, undefined);
  }
  let calls = 0;
  const store = new ScoreStore(storage(), async url => { calls++; return result(url); });
  await store.refresh('', false);
  assert.equal(calls, 0);
  assert.match(store.message, /valid key/);
});

test('failed persistence keeps new scores for the session and reports the limitation', async () => {
  const disk = storage();
  disk.update = async () => { throw new Error('disk unavailable'); };
  const store = new ScoreStore(disk, async url => result(url), () => NOW);
  await store.refresh('test-key', false);
  assert.equal(store.snapshot?.records.length, 2);
  assert.equal(disk.value, undefined);
  assert.match(store.message, /session but could not be saved/);
});

test('clearing invalidates a pending response even if the fetcher ignores cancellation', async () => {
  const gate = deferred();
  const disk = storage(saved);
  let signal: AbortSignal | null | undefined;
  const store = new ScoreStore(disk, async (url, options) => { signal = options?.signal; await gate.promise; return result(url); }, () => NOW);
  const refresh = store.refresh('test-key', false);
  assert.equal(await store.clear(), true);
  assert.equal(signal?.aborted, true);
  gate.release();
  await refresh;
  assert.equal(store.snapshot, undefined);
  assert.equal(disk.value, undefined);
  assert.deepEqual(disk.writes, [undefined]);
  assert.match(store.message, /cleared from this device/);
});

test('clear follows an already-started save so its late completion cannot restore scores', async () => {
  const gate = deferred();
  const started = deferred();
  const disk = storage();
  disk.update = async (_key, value) => {
    if (value !== undefined) { started.release(); await gate.promise; }
    disk.value = structuredClone(value);
    disk.writes.push(disk.value);
  };
  const store = new ScoreStore(disk, async url => result(url), () => NOW);
  const refresh = store.refresh('test-key', false);
  await started.promise;
  const clearing = store.clear();
  assert.equal(store.snapshot, undefined);
  gate.release();
  await refresh;
  assert.equal(await clearing, true);
  assert.equal(disk.value, undefined);
  assert.equal(disk.writes.length, 2);
  assert.equal(disk.writes[1], undefined);
});

test('failed clearing is honest about persistence and may be retried', async () => {
  const disk = storage(saved);
  disk.update = async () => { throw new Error('disk unavailable'); };
  const store = new ScoreStore(disk);
  assert.equal(await store.clear(), false);
  assert.equal(store.snapshot, undefined);
  assert.deepEqual(disk.value, saved);
  assert.match(store.message, /may return after restarting/);
  disk.update = async (_key, value) => { disk.value = value; };
  assert.equal(await store.clear(), true);
  assert.equal(disk.value, undefined);
});

test('mixed source dates and future cached timestamps cannot make scores look current', async () => {
  for (const field of ['source', 'evaluation']) {
    const store = new ScoreStore(storage(saved), async url => {
      const response = await result(url).json();
      if (String(url).includes('tau_bench')) {
        if (field === 'source') response.meta.as_of = '2099-01-01T00:00:00Z';
        else response.data[0].last_run_timestamp = '2099-01-01T00:00:00Z';
      }
      return Response.json(response);
    }, () => NOW);
    await store.refresh('test-key', false);
    assert.deepEqual(store.snapshot, saved);
    assert.match(store.message, /Keeping the previously saved scores/);
  }
  for (const cached of [
    { ...saved, fetchedAt: '2099-01-01T00:00:00Z' },
    { ...saved, records: [{ ...saved.records[0], asOf: '2099-01-01T00:00:00Z' }] },
    { ...saved, records: [{ ...saved.records[0], evaluatedAt: '2099-01-01T00:00:00Z' }] },
  ]) {
    const store = new ScoreStore(storage(cached), undefined, () => NOW);
    assert.equal(store.snapshot, undefined);
    assert.match(store.message, /could not be read/);
  }
});
