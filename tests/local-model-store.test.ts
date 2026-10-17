import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalModelStore, parseDiscoveredModels } from '../src/local-model-store.ts';
import { runtimeKey } from '../src/core.ts';
import type { CatalogStorage } from '../src/catalog-store.ts';
import type { DiscoveredModel, LocalModel } from '../src/types.ts';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const KEY = 'localModels.v1';

function model(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return { id: 'alpha', name: 'Alpha', vendor: 'copilot', family: 'alpha', version: '1', maxInputTokens: 128_000, ...overrides };
}

function saved(overrides: Partial<LocalModel> = {}): LocalModel {
  return { ...model(), lastSeen: new Date(NOW).toISOString(), ...overrides };
}

function storage(initial?: unknown): CatalogStorage & { value: unknown; writes: unknown[] } {
  return {
    value: initial, writes: [],
    get<T>(key: string): T | undefined { assert.equal(key, KEY); return this.value as T | undefined; },
    async update(key, value) {
      assert.equal(key, KEY);
      this.value = structuredClone(value);
      this.writes.push(this.value);
    },
  };
}

test('discovery metadata is allowlisted and detached from API objects', () => {
  const input = { ...model(), endpoint: 'https://private.example', apiKey: 'secret', sendRequest: () => {} };
  const parsed = parseDiscoveredModels([input]);
  assert.deepEqual(parsed, [model()]);
  input.name = 'Changed later';
  assert.equal(parsed[0].name, 'Alpha');
  assert.deepEqual(parseDiscoveredModels([model({ family: '', version: '', maxInputTokens: 0 })]), [model({ family: '', version: '', maxInputTokens: 0 })]);
});

test('discovery rejects malformed records, oversized batches and invalid numeric limits', () => {
  for (const input of [null, {}, [null], [[]], ['model'], Array(1_001).fill(model()),
    [{ ...model(), id: '' }], [{ ...model(), vendor: ' ' }], [{ ...model(), name: 'x'.repeat(201) }],
    [{ ...model(), version: undefined }], [{ ...model(), family: 'x'.repeat(201) }]]) {
    assert.throws(() => parseDiscoveredModels(input), /Invalid model metadata/);
  }
  for (const maxInputTokens of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseDiscoveredModels([model({ maxInputTokens })]), /maxInputTokens/);
  }
  assert.equal(parseDiscoveredModels(Array.from({ length: 1_000 }, (_, index) => model({ id: String(index) }))).length, 1_000);
});

test('models roundtrip with ISO timestamps and only expected fields', async () => {
  const disk = storage();
  const store = new LocalModelStore(disk, () => NOW);
  assert.deepEqual(store.models, []);
  await store.remember([{ ...model(), endpoint: 'private', apiKey: 'secret' } as DiscoveredModel]);
  assert.deepEqual(store.models, [saved()]);
  assert.deepEqual(disk.value, [saved()]);
  assert.deepEqual(new LocalModelStore(disk).models, [saved()]);
  assert.match(new LocalModelStore(disk).message, /availability has not been checked/);
  assert.equal(JSON.stringify(disk.value).includes('secret'), false);
});

test('saved metadata strips unexpected fields without exposing secrets', () => {
  const store = new LocalModelStore(storage([{ ...saved(), apiKey: 'secret', endpoint: 'private', guidance: [] }]));
  assert.deepEqual(store.models, [saved()]);
});

test('corrupt, duplicate, oversized or unreadable storage fails safely', () => {
  for (const input of [null, {}, [model()], [saved({ lastSeen: '2026-02-30T12:00:00.000Z' })],
    [saved({ lastSeen: '2026-10-17' })], [saved({ lastSeen: '2026-10-17T12:00:00.000Z\n' })],
    [saved(), saved()], Array(1_001).fill(saved())]) {
    const store = new LocalModelStore(storage(input));
    assert.deepEqual(store.models, []);
    assert.match(store.message, /could not be read/);
  }
  const disk = storage();
  disk.get = () => { throw new Error('unreadable'); };
  assert.match(new LocalModelStore(disk).message, /could not be read/);
});

test('remember updates matching metadata while retaining absent identities and their timestamps', async () => {
  let now = NOW;
  const disk = storage();
  const store = new LocalModelStore(disk, () => now);
  await store.remember([model(), model({ id: 'beta', name: 'Beta' })]);
  now += 60_000;
  await store.remember([model({ name: 'Alpha renamed', maxInputTokens: 256_000 })]);
  assert.equal(store.models.length, 2);
  assert.equal(store.models[0].name, 'Alpha renamed');
  assert.equal(store.models[0].maxInputTokens, 256_000);
  assert.equal(store.models[0].lastSeen, new Date(now).toISOString());
  assert.equal(store.models[1].id, 'beta');
  assert.equal(store.models[1].lastSeen, new Date(NOW).toISOString());
  await store.remember([]);
  assert.equal(store.models.length, 2);
  assert.equal(store.models[1].lastSeen, new Date(NOW).toISOString());
});

test('provider/version scope and delimiter-bearing identities remain separate', async () => {
  const store = new LocalModelStore(storage(), () => NOW);
  const models = [model(), model({ vendor: 'custom' }), model({ version: '2' }),
    model({ vendor: 'a:b', id: 'c' }), model({ vendor: 'a', id: 'b:c' })];
  await store.remember(models);
  assert.equal(store.models.length, models.length);
  assert.equal(new Set(store.models.map(runtimeKey)).size, models.length);
  await store.remember([model(), model({ name: 'Latest duplicate' })]);
  assert.equal(store.models.length, models.length);
  assert.equal(store.models.find(value => runtimeKey(value) === runtimeKey(model()))!.name, 'Latest duplicate');
});

test('retention keeps at most 1000 identities and prefers newly seen entries on timestamp ties', async () => {
  const store = new LocalModelStore(storage(), () => NOW);
  await store.remember(Array.from({ length: 1_000 }, (_, index) => model({ id: String(index) })));
  await store.remember([model({ id: 'newest' })]);
  assert.equal(store.models.length, 1_000);
  assert.equal(store.models[0].id, 'newest');
  assert.equal(store.models.some(value => value.id === '999'), false);
  assert.match(store.message, /1000 most recently seen/);
});

test('invalid new metadata cannot change existing session or saved models', async () => {
  const disk = storage([saved()]);
  const store = new LocalModelStore(disk, () => NOW);
  await assert.rejects(store.remember([model({ maxInputTokens: -1 })]), /maxInputTokens/);
  assert.deepEqual(store.models, [saved()]);
  assert.equal(disk.writes.length, 0);
});

test('failed saving retains current session data and reports lack of persistence', async () => {
  const disk = storage();
  disk.update = async () => { throw new Error('disk full'); };
  const store = new LocalModelStore(disk, () => NOW);
  await store.remember([model()]);
  assert.deepEqual(store.models, [saved()]);
  assert.equal(disk.value, undefined);
  assert.match(store.message, /session but could not be saved/);
});

test('clear removes the persistent key and failed deletion never promises persistent clearing', async () => {
  const disk = storage([saved()]);
  const store = new LocalModelStore(disk, () => NOW);
  disk.update = async () => { throw new Error('disk unavailable'); };
  assert.equal(await store.clear(), false);
  assert.deepEqual(store.models, []);
  assert.deepEqual(disk.value, [saved()]);
  assert.match(store.message, /saved data could not be removed/);
  assert.match(store.message, /may return after restarting/);
  disk.update = async (key, value) => { assert.equal(key, KEY); disk.value = value; };
  assert.equal(await store.clear(), true);
  assert.equal(disk.value, undefined);
  assert.match(store.message, /cleared from this device/);
  assert.deepEqual(new LocalModelStore(disk).models, []);
});

test('clear waits for an in-flight remember write and cannot be undone by its completion', async () => {
  const disk = storage();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { started = resolve; });
  disk.update = async (_key, value) => {
    if (value !== undefined) { started(); await gate; }
    disk.value = structuredClone(value);
    disk.writes.push(disk.value);
  };
  const store = new LocalModelStore(disk, () => NOW);
  const remembering = store.remember([model()]);
  await writing;
  const clearing = store.clear();
  assert.equal(disk.writes.length, 0);
  release();
  const [, cleared] = await Promise.all([remembering, clearing]);
  assert.equal(cleared, true);
  assert.deepEqual(disk.writes, [[saved()], undefined]);
  assert.equal(disk.value, undefined);
  assert.deepEqual(store.models, []);
  assert.match(store.message, /cleared from this device/);
});

test('an explicit remember after clearing works and queued saves preserve both batches', async () => {
  const disk = storage([saved()]);
  const store = new LocalModelStore(disk, () => NOW);
  const clearing = store.clear();
  const one = store.remember([model({ id: 'new-one' })]);
  const two = store.remember([model({ id: 'new-two' })]);
  await Promise.all([clearing, one, two]);
  assert.deepEqual(new Set(store.models.map(value => value.id)), new Set(['new-one', 'new-two']));
  assert.deepEqual(disk.value, store.models);
});
