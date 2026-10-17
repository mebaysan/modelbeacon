import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activePricing, areComparable, compareCatalogRevision, isSafeExternalUrl, isStale, isWebviewRequest,
  matchModel, parseCatalog, recommendations, runtimeKey,
} from '../src/core.ts';
import type { BenchmarkObservation, Catalog, CatalogModel, DiscoveredModel } from '../src/types.ts';

const source = {
  id: 'official', title: 'Official documentation', url: 'https://example.com/models',
  license: 'CC BY 4.0', licenseUrl: 'https://example.com/license', retrievedAt: '2026-10-17',
};

function model(id = 'alpha', name = 'Alpha'): CatalogModel {
  return {
    id, name, provider: 'Provider', aliases: [{ id: `runtime-${id}`, version: '1' }],
    facts: [{ text: 'Supports coding.', sourceId: source.id }],
    guidance: [{ task: 'everyday', rationale: 'Useful for small changes.', limitation: 'Verify output.', sourceId: source.id }],
    pricing: { sourceId: source.id, reviewedAt: '2026-10-17', tiers: [{ name: 'Standard', inputUsdPerMillion: 1, outputUsdPerMillion: 4 }] },
  };
}

function observation(id = 'score-alpha', modelId = 'alpha'): BenchmarkObservation {
  return {
    id, modelId, benchmark: 'Example Evaluation', benchmarkVersion: '1.0', agent: 'Test Agent',
    agentVersion: '1.0', reasoningEffort: 'high', accuracy: 72.4, ci95: 1.3, trials: 5,
    sourceId: source.id, comparisonGroup: 'reviewed-group', modelReleasedAt: '2026-09-01',
    submittedAt: '2026-10-01', evaluatedAt: '2026-09-30',
  };
}

function catalog(): Catalog {
  return {
    schemaVersion: 1, revision: '2026-10-17.1', reviewedAt: '2026-10-17',
    sources: [structuredClone(source)], models: [model()], benchmarks: [observation()],
  };
}

function runtime(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return { id: 'runtime-alpha', name: 'Alpha', vendor: 'copilot', family: 'alpha', version: '1', maxInputTokens: 128_000, ...overrides };
}

test('catalog validation accepts complete data, empty evidence, and leap-day dates', () => {
  const complete = catalog();
  assert.equal(parseCatalog(complete), complete);
  complete.benchmarks = [];
  complete.models[0].aliases = [];
  complete.reviewedAt = '2024-02-29';
  complete.revision = '2024-02-29.1';
  assert.doesNotThrow(() => parseCatalog(complete));
});

test('catalog revisions have a matching review date and bounded positive sequence', () => {
  for (const revision of ['2026-10-17.1', '2026-10-17.10', '2026-10-17.9999999']) {
    assert.doesNotThrow(() => parseCatalog({ ...catalog(), revision }));
  }
  for (const revision of ['', 'seed', '2026-10-17', '2026-10-17.0', '2026-10-17.-1',
    '2026-10-17.01', '2026-10-17.1.2', '2026-10-17.1e2', '2026-10-17.10000000',
    '2026-10-17.9007199254740992', '2026-10-17.1\n', '2026-10-16.1', '2026-02-30.1']) {
    assert.throws(() => parseCatalog({ ...catalog(), revision }), /revision/);
  }
});

test('catalog revision ordering compares dates first and same-day sequences numerically', () => {
  const older = parseCatalog({ ...catalog(), revision: '2026-10-17.2' });
  const newer = parseCatalog({ ...catalog(), revision: '2026-10-17.10' });
  const tomorrow = parseCatalog({ ...catalog(), reviewedAt: '2026-10-18', revision: '2026-10-18.1' });
  assert.ok(compareCatalogRevision(older, newer) < 0);
  assert.ok(compareCatalogRevision(newer, older) > 0);
  assert.equal(compareCatalogRevision(newer, structuredClone(newer)), 0);
  assert.ok(compareCatalogRevision(newer, tomorrow) < 0);
  assert.ok(compareCatalogRevision(tomorrow, newer) > 0);
});

test('catalog validation reports malformed, unsupported, and oversized data', () => {
  for (const input of [null, [], 'catalog', { ...catalog(), schemaVersion: 2 }]) {
    assert.throws(() => parseCatalog(input), /Invalid catalog:/);
  }
  const oversized = catalog();
  oversized.models[0].name = 'a'.repeat(201);
  assert.throws(() => parseCatalog(oversized), /models\[0\]\.name/);
  const tooMany = catalog();
  tooMany.benchmarks = Array(5_001).fill(observation());
  assert.throws(() => parseCatalog(tooMany), /benchmarks must be an array of at most 5000/);
});

test('all dates reject rollover dates, timestamps, empty values and malformed optional dates', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-17T00:00:00Z', '', '10/17/2026']) {
    const input = catalog();
    input.reviewedAt = date;
    assert.throws(() => parseCatalog(input), /reviewedAt.*calendar date/);
  }
  for (const field of ['modelReleasedAt', 'submittedAt', 'evaluatedAt'] as const) {
    const input = catalog();
    input.benchmarks[0][field] = '2026-02-30';
    assert.throws(() => parseCatalog(input), new RegExp(field));
  }
  const input = catalog();
  input.models[0].pricing!.validThrough = 'yesterday';
  assert.throws(() => parseCatalog(input), /validThrough/);
});

test('source links must be HTTPS and cannot contain credentials or whitespace', () => {
  for (const url of ['javascript:alert(1)', 'command:workbench.action.closeWindow', 'http://example.com', 'https://user:pass@example.com', 'https://example.com\n', '/models']) {
    const input = catalog();
    input.sources[0].url = url;
    assert.throws(() => parseCatalog(input), /sources\[0\]\.url/);
    assert.equal(isSafeExternalUrl(url), false);
  }
  assert.equal(isSafeExternalUrl('https://example.com/models?version=1#details'), true);
  assert.equal(isSafeExternalUrl(null), false);
  const input = catalog();
  input.sources[0].licenseUrl = 'file:///license';
  assert.throws(() => parseCatalog(input), /licenseUrl/);
});

test('catalog references and IDs must be complete and unique', () => {
  const mutations: [string, (value: Catalog) => void][] = [
    ['sources', value => value.sources.push(structuredClone(source))],
    ['models', value => value.models.push(model())],
    ['benchmarks', value => value.benchmarks.push(observation())],
    ['sourceId', value => { value.models[0].facts[0].sourceId = 'missing'; }],
    ['sourceId', value => { value.models[0].guidance[0].sourceId = 'missing'; }],
    ['sourceId', value => { value.models[0].pricing!.sourceId = 'missing'; }],
    ['sourceId', value => { value.benchmarks[0].sourceId = 'missing'; }],
    ['modelId', value => { value.benchmarks[0].modelId = 'missing'; }],
  ];
  for (const [field, mutate] of mutations) {
    const input = catalog();
    mutate(input);
    assert.throws(() => parseCatalog(input), new RegExp(field));
  }
});

test('duplicate and overlapping aliases are rejected; distinct explicit versions are accepted', () => {
  const input = catalog();
  const second = model('beta', 'Beta');
  second.aliases = [{ id: 'runtime-alpha', version: '2' }];
  input.models.push(second);
  assert.doesNotThrow(() => parseCatalog(input));
  second.aliases[0].version = '1';
  assert.throws(() => parseCatalog(input), /overlaps alias/);
  delete second.aliases[0].version;
  assert.throws(() => parseCatalog(input), /overlaps alias/);
  input.models.pop();
  input.models[0].aliases.push({ id: 'runtime-alpha', version: '1' });
  assert.throws(() => parseCatalog(input), /overlaps alias/);
});

test('scores, confidence intervals, trials and pricing reject invalid numeric values', () => {
  for (const accuracy of [-1, 100.1, NaN, Infinity]) {
    const input = catalog();
    input.benchmarks[0].accuracy = accuracy;
    assert.throws(() => parseCatalog(input), /accuracy/);
  }
  for (const trials of [0, -1, 1.5, Infinity]) {
    const input = catalog();
    input.benchmarks[0].trials = trials;
    assert.throws(() => parseCatalog(input), /trials/);
  }
  const input = catalog();
  input.benchmarks[0].ci95 = -1;
  assert.throws(() => parseCatalog(input), /ci95/);
  input.benchmarks[0].ci95 = 0;
  input.models[0].pricing!.tiers[0].inputUsdPerMillion = -1;
  assert.throws(() => parseCatalog(input), /inputUsdPerMillion/);
  input.models[0].pricing!.tiers = [];
  assert.throws(() => parseCatalog(input), /at least one tier/);
});

test('guidance tasks are known and unique per model', () => {
  const input = catalog();
  input.models[0].guidance.push(structuredClone(input.models[0].guidance[0]));
  assert.throws(() => parseCatalog(input), /duplicates ID everyday/);
  input.models[0].guidance.pop();
  (input.models[0].guidance[0] as { task: string }).task = 'unknown';
  assert.throws(() => parseCatalog(input), /supported task/);
});

test('matching requires explicit ID, matching optional version, Copilot vendor and no ambiguity', () => {
  const input = catalog();
  assert.equal(matchModel(runtime(), input)?.id, 'alpha');
  assert.equal(matchModel(runtime({ id: 'alpha' }), input), undefined);
  assert.equal(matchModel(runtime({ id: 'runtime-alpha-preview' }), input), undefined);
  assert.equal(matchModel(runtime({ version: '2' }), input), undefined);
  assert.equal(matchModel(runtime({ vendor: 'other' }), input), undefined);
  delete input.models[0].aliases[0].version;
  assert.equal(matchModel(runtime({ version: '2' }), input)?.id, 'alpha');
  const second = model('beta', 'Beta');
  second.aliases = [{ id: 'runtime-alpha' }];
  input.models.push(second);
  assert.equal(matchModel(runtime(), input), undefined);
});

test('runtime identities include provider and version without delimiter collisions', () => {
  const variants = [runtime(), runtime({ vendor: 'custom' }), runtime({ version: '2' }),
    runtime({ vendor: 'a:b', id: 'c', version: 'd' }), runtime({ vendor: 'a', id: 'b:c', version: 'd' }),
    runtime({ vendor: 'a', id: 'b', version: 'c:d' }), runtime({ id: 'quote"\\value' })];
  assert.equal(new Set(variants.map(runtimeKey)).size, variants.length);
  assert.equal(runtimeKey(runtime()), runtimeKey(runtime({ name: 'Renamed display', family: 'new-family', maxInputTokens: 5 })));
  assert.ok(runtimeKey(runtime()).startsWith('runtime:'));
  assert.equal(matchModel(runtime({ vendor: 'custom' }), catalog()), undefined);
});

test('recommendations select curated candidates before alphabetic display and explicitly filter availability', () => {
  const input = catalog();
  input.models = [model('delta', 'Delta'), model('charlie', 'Charlie'), model('alpha', 'Alpha'), model('beta', 'Beta')];
  assert.deepEqual(recommendations(input, 'everyday', [], false).map(value => value.id), ['alpha', 'charlie', 'delta']);
  assert.deepEqual(recommendations(input, 'everyday', [runtime()], false).map(value => value.id), ['alpha', 'charlie', 'delta']);
  assert.deepEqual(recommendations(input, 'everyday', [runtime()], true).map(value => value.id), ['alpha']);
  assert.deepEqual(recommendations(input, 'everyday', [runtime({ id: 'unknown' })], true), []);
  assert.deepEqual(recommendations(input, 'everyday', [runtime({ vendor: 'custom' })], true), []);
  assert.deepEqual(recommendations(input, 'everyday', [], true), []);
  assert.deepEqual(recommendations(input, 'visual', [], false), []);
  assert.equal(input.models[0].id, 'delta', 'sorting must not mutate the catalog');
});

test('comparison requires a reviewed group and identical evaluation configuration', () => {
  const first = observation();
  const second = observation('score-beta', 'beta');
  assert.equal(areComparable([first, second]), true);
  assert.equal(areComparable([]), false);
  assert.equal(areComparable([first]), false);
  for (const key of ['comparisonGroup', 'benchmark', 'benchmarkVersion', 'agent', 'agentVersion', 'reasoningEffort'] as const) {
    assert.equal(areComparable([first, { ...second, [key]: 'different' }]), false, key);
  }
  assert.equal(areComparable([{ ...first, comparisonGroup: undefined }, { ...second, comparisonGroup: undefined }]), false);
  assert.equal(areComparable([{ ...first, comparisonGroup: ' ' }, { ...second, comparisonGroup: ' ' }]), false);
});

test('staleness uses a strict fourteen-day cutoff and treats invalid dates as stale', () => {
  assert.equal(isStale('2026-10-01', Date.parse('2026-10-15T00:00:00Z')), false);
  assert.equal(isStale('2026-10-01', Date.parse('2026-10-15T00:00:00.001Z')), true);
  assert.equal(isStale('2026-10-18', Date.parse('2026-10-17T00:00:00Z')), false);
  assert.equal(isStale('invalid'), true);
});

test('promotional pricing remains visible through its inclusive UTC expiry date', () => {
  const value = model();
  value.pricing!.validThrough = '2026-10-17';
  assert.equal(activePricing(value, Date.parse('2026-10-17T23:59:59.999Z')), value.pricing);
  assert.equal(activePricing(value, Date.parse('2026-10-18T00:00:00Z')), undefined);
  value.pricing!.validThrough = 'invalid';
  assert.equal(activePricing(value), undefined);
  delete value.pricing!.validThrough;
  assert.equal(activePricing(value, Date.parse('2099-01-01')), value.pricing);
  delete value.pricing;
  assert.equal(activePricing(value), undefined);
});

test('webview requests allow only known messages with their exact payload', () => {
  for (const type of ['ready', 'detectModels', 'clearLocalModels', 'refreshCatalog', 'openPicker', 'connectScores', 'refreshScores', 'clearScores']) {
    assert.equal(isWebviewRequest({ type }), true);
  }
  assert.equal(isWebviewRequest({ type: 'openSource', sourceId: 'official' }), true);
  for (const topic of ['auto', 'legacy', 'signin']) assert.equal(isWebviewRequest({ type: 'openHelp', topic }), true);
  assert.equal(isWebviewRequest({ type: 'setAutoUpdate', enabled: false }), true);
  assert.equal(isWebviewRequest({ type: 'setCompositeScores', enabled: false }), true);
  assert.equal(isWebviewRequest({ type: 'linkScores', key: '["catalog","test"]' }), true);
  assert.equal(isWebviewRequest({ type: 'showScores', key: '["catalog","test"]' }), true);
  assert.equal(isWebviewRequest({ type: 'unlinkScores', key: '["catalog","test"]' }), true);
  for (const metric of ['intelligence', 'coding', 'agentic', 'gpqa', 'toolUse']) assert.equal(isWebviewRequest({ type: 'openScoreSource', metric }), true);
  for (const input of [null, [], {}, { type: 'executeCommand' }, { type: 'ready', command: 'bad' },
    { type: 'openSource', sourceId: '' }, { type: 'openSource', sourceId: 4 },
    { type: 'clearLocalModels', sourceId: 'official' },
    { type: 'connectScores', apiKey: 'never-use-webview-for-secrets' },
    { type: 'linkScores', key: 'x'.repeat(1801) }, { type: 'unlinkScores', key: '' },
    { type: 'showScores', key: '' }, { type: 'showScores', key: 'x'.repeat(1801) },
    { type: 'showScores', key: '["catalog","test"]', apiKey: 'not-allowed' },
    { type: 'openScoreSource', metric: 'constructor' }, { type: 'setCompositeScores', enabled: 'true' },
    { type: 'openHelp', topic: 'https://example.com' }, { type: 'setAutoUpdate', enabled: 'true' }]) {
    assert.equal(isWebviewRequest(input), false);
  }
});
