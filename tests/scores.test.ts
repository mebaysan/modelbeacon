import assert from 'node:assert/strict';
import test from 'node:test';
import { findScoreReference, parseScoreResponses, parseScoreSnapshot, SCORE_METRICS } from '../src/scores.ts';
import type { ModelScore } from '../src/types.ts';

const DATE = '2026-10-17T12:00:00Z';
const aa = { source: 'artificial-analysis', model_permaslug: 'openai/example-1', display_name: 'Example 1', intelligence_index: 71.2, coding_index: 65.8, agentic_index: 58.3 };
const gpqa = { source: 'openrouter', model_permaslug: 'openai/example-1', display_name: 'Example 1', benchmark_type: 'gpqa_diamond', accuracy: 0.72, accuracy_stddev: 0.03, total_tasks: 300, last_run_timestamp: DATE };
function response(data: unknown[], asOf = DATE) { return { data, meta: { as_of: asOf } }; }

function score(modelId: string, modelName: string, metric: ModelScore['metric'] = 'gpqa', value = 72): ModelScore {
  return { modelId, modelName, metric, value };
}

test('automatic references match exact public identities and unique provider-prefixed names across metrics', () => {
  const records = [
    score('openai/gpt-6.1-sol-20260929', 'OpenAI: GPT-6.1 Sol'),
    score('openai/gpt-6.1-sol-20260929', 'GPT-6.1 Sol (Max)', 'intelligence'),
    score('openai/gpt-6.1-sol-pro-20260929', 'OpenAI: GPT-6.1 Sol Pro'),
  ];
  assert.equal(findScoreReference({ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'OpenAI' }, records), records[0].modelId);
  assert.equal(findScoreReference({ id: records[0].modelId, name: 'Private deployment', vendor: 'organization' }, records), records[0].modelId);
  assert.equal(findScoreReference({ id: 'private-deployment', name: 'GPT-6.1 Sol', vendor: 'copilot', version: '1.0' }, records), records[0].modelId);
  assert.equal(findScoreReference({ id: 'private-deployment', name: 'OpenAI: GPT-6.1 Sol', vendor: 'organization' }, records), records[0].modelId);
  assert.equal(findScoreReference({ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'Other' }, records), undefined);
});

test('automatic names retain numeric versions and all reasoning and model variants', () => {
  const records = [
    score('vendor/example-5.3', 'Vendor: Example 5.3'),
    score('vendor/example-5.3-high', 'Vendor: Example 5.3 (High)'),
    score('vendor/example-5.3-mini', 'Vendor: Example 5.3 Mini'),
  ];
  assert.equal(findScoreReference({ id: 'custom', name: 'Example 5.3' }, records), 'vendor/example-5.3');
  assert.equal(findScoreReference({ id: 'custom', name: 'Example 5.3 (High)' }, records), 'vendor/example-5.3-high');
  assert.equal(findScoreReference({ id: 'custom', name: 'Example 5.30' }, records), undefined);
  assert.equal(findScoreReference({ id: 'custom', name: 'Example 5' }, records), undefined);
  assert.equal(findScoreReference({ id: 'custom', name: 'Example 5.3 (Low)' }, records), undefined);
  assert.equal(findScoreReference({ id: 'custom', name: 'Example 5.3' }, records.slice(1)), undefined);
});

test('automatic references refuse ambiguous IDs even with identical scores or different metric coverage', () => {
  const records = [
    score('vendor/example-5-20260901', 'Vendor: Example 5'),
    score('vendor/example-5-20261001', 'Example 5', 'intelligence'),
  ];
  assert.equal(findScoreReference({ id: 'example-5', name: 'Example 5', provider: 'vendor' }, records), undefined);
  assert.equal(findScoreReference({ id: records[0].modelId, name: 'Example 5' }, records), records[0].modelId);
  assert.equal(findScoreReference({ id: 'vendor/example-5-20260801', name: 'Example 5' }, records), undefined);
  assert.equal(findScoreReference({ id: 'custom', name: 'Example 5', version: '2026-10-01' }, records), records[1].modelId);
  assert.equal(findScoreReference({ id: 'custom', name: 'Example 5', version: '2026-08-01' }, records), undefined);
  assert.equal(findScoreReference({ id: records[0].modelId, name: 'Example 5', version: '2026-10-01' }, records), undefined);
  assert.equal(findScoreReference({ id: 'VENDOR/EXAMPLE-5', name: 'Example 5' }, [score('vendor/example-5', 'Example 5'), score('Vendor/Example-5', 'Example 5')]), undefined);
});

test('public providers disambiguate names while organization vendors do not invent a manufacturer', () => {
  const records = [
    score('deepseek/deepseek-v4', 'DeepSeek: DeepSeek V4'),
    score('other/deepseek-v4', 'Other: DeepSeek V4'),
    score('moonshotai/kimi-k3', 'MoonshotAI: Kimi K3'),
    score('x-ai/grok-4.6-20260810', 'xAI: Grok 4.6'),
  ];
  assert.equal(findScoreReference({ id: 'private', name: 'DeepSeek V4', vendor: 'organization' }, records), undefined);
  assert.equal(findScoreReference({ id: 'private', name: 'DeepSeek V4', provider: 'DeepSeek' }, records), records[0].modelId);
  assert.equal(findScoreReference({ id: 'private', name: 'DeepSeek V4', vendor: 'deepseek' }, records), records[0].modelId);
  assert.equal(findScoreReference({ id: 'kimi-k3', name: 'Kimi K3', provider: 'Moonshot AI' }, records), records[2].modelId);
  assert.equal(findScoreReference({ id: 'grok-4.6', name: 'Grok 4.6', provider: 'xAI' }, records), records[3].modelId);
  assert.equal(findScoreReference({ id: 'private', name: 'DeepSeek V4' }, [score('deepseek/experimental-1', 'Experiment: DeepSeek V4')]), undefined);
});

test('custom model names can resolve public references without saving private identities; zero is still a score', () => {
  const records = [score('z-ai/glm-5.3', 'Z.AI: GLM 5.3', 'gpqa', 0)];
  const before = structuredClone(records);
  assert.equal(findScoreReference({ id: 'organization/private-deployment', name: 'GLM-5.3', vendor: 'organization' }, records), records[0].modelId);
  assert.equal(findScoreReference({ id: 'z-ai/glm-5.3', name: 'Private model', vendor: 'organization' }, records), records[0].modelId);
  assert.equal(findScoreReference({ id: 'private', name: 'GLM 5.3' }, []), undefined);
  assert.deepEqual(records, before);
});

test('API scores retain distinct units and sources, with standard deviation rather than invented confidence intervals', () => {
  const snapshot = parseScoreResponses([response([aa, gpqa, { ...gpqa, benchmark_type: 'tau_bench_verified_airline', accuracy: 0.68 }])], true, DATE);
  assert.deepEqual(snapshot.records.map(row => [row.metric, row.value]), [['intelligence', 71.2], ['coding', 65.8], ['agentic', 58.3], ['gpqa', 72], ['toolUse', 68]]);
  assert.equal(snapshot.records[3].standardDeviation, 3);
  assert.equal(snapshot.records[3].sampleSize, 300);
  assert.equal(snapshot.records[0].standardDeviation, undefined);
  assert.equal(SCORE_METRICS.intelligence.unit, 'points');
  assert.equal(SCORE_METRICS.gpqa.unit, '%');
  assert.match(SCORE_METRICS.coding.source, /Artificial Analysis/);
  assert.equal('ci95' in snapshot.records[3], false);
});

test('composites are excluded unless selected; unrequested benchmark types are ignored', () => {
  const snapshot = parseScoreResponses([response([aa, gpqa, { source: 'openrouter', benchmark_type: 'search_browsecomp', accuracy: 'invalid' }, { source: 'design-arena' }])], false, DATE);
  assert.deepEqual(snapshot.records.map(row => row.metric), ['gpqa']);
  assert.equal(snapshot.includesComposites, false);
});

test('null and missing scores stay unavailable while a real zero remains zero', () => {
  const snapshot = parseScoreResponses([response([{ ...aa, intelligence_index: null, coding_index: undefined, agentic_index: 0 }, { ...gpqa, accuracy: null }, { ...gpqa, accuracy: undefined }])], true, DATE);
  assert.deepEqual(snapshot.records.map(row => [row.metric, row.value]), [['agentic', 0]]);
  assert.equal(parseScoreResponses([response([{ ...gpqa, accuracy: 0, accuracy_stddev: null }])], false, DATE).records[0].standardDeviation, undefined);
});

test('unrelated API fields, prices and arbitrary endpoint URLs never enter the cache', () => {
  const snapshot = parseScoreResponses([response([{ ...aa, api_key: 'private', pricing: { prompt: '0.1' } }, { ...gpqa, avg_cost_per_task: 10 }])], true, DATE);
  const parsed = parseScoreSnapshot({ ...snapshot, key: 'secret', records: snapshot.records.map(row => ({ ...row, endpoint: 'private' })) });
  assert.deepEqual(parsed, snapshot);
  assert.doesNotMatch(JSON.stringify(parsed), /private|secret|pricing|avg_cost|endpoint/);
});

test('source attribution, URLs and API versions survive normalization and cache reload per response', () => {
  const snapshot = parseScoreResponses([
    { data: [aa], meta: { as_of: DATE, citation: 'Source: Artificial Analysis via OpenRouter.', source: 'artificial-analysis', source_url: 'https://artificialanalysis.ai', version: 'v1' } },
    { data: [gpqa], meta: { as_of: '2026-10-16T12:00:00Z', citation: 'Source: OpenRouter.', source: 'openrouter', source_url: 'https://openrouter.ai/rankings', version: 'v2' } },
  ], true, DATE);
  assert.deepEqual(snapshot.records.map(({ source, sourceUrl, sourceVersion }) => [source, sourceUrl, sourceVersion]), [
    ...Array(3).fill(['artificial-analysis', 'https://artificialanalysis.ai', 'v1']),
    ['openrouter', 'https://openrouter.ai/rankings', 'v2'],
  ]);
  assert.equal(snapshot.records[3].citation, 'Source: OpenRouter.');
  assert.equal(snapshot.records[3].asOf, '2026-10-16T12:00:00.000Z');
  assert.deepEqual(parseScoreSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);

  const legacy = parseScoreResponses([response([gpqa])], false, DATE);
  assert.equal('sourceUrl' in legacy.records[0], false);
  assert.deepEqual(parseScoreSnapshot(legacy), legacy);
  const missing = parseScoreResponses([{ data: [gpqa], meta: { as_of: DATE, source: null, source_url: null, version: null, citation: null } }], false, DATE);
  assert.deepEqual(missing, legacy);
});

test('source metadata is bounded text and only credential-free HTTPS source links are accepted', () => {
  const snapshot = parseScoreResponses([response([gpqa])], false, DATE);
  for (const source_url of ['javascript:alert(1)', 'command:workbench.action.openSettings', 'file:///tmp/data', 'http://example.com', 'https://user:secret@example.com', 'https://example.com/\n', 'https://example.com/' + 'a'.repeat(2048), 42]) {
    assert.throws(() => parseScoreResponses([{ data: [gpqa], meta: { as_of: DATE, source_url } }], false, DATE), /source URL/);
    assert.throws(() => parseScoreSnapshot({ ...snapshot, records: [{ ...snapshot.records[0], sourceUrl: source_url }] }), /source URL/);
  }
  for (const invalid of ['', 'a'.repeat(201), 'source\ntext', 1, {}]) {
    for (const [api, saved] of [['source', 'source'], ['version', 'sourceVersion']]) {
      assert.throws(() => parseScoreResponses([{ data: [gpqa], meta: { as_of: DATE, [api]: invalid } }], false, DATE), /text/);
      assert.throws(() => parseScoreSnapshot({ ...snapshot, records: [{ ...snapshot.records[0], [saved]: invalid }] }), /text/);
    }
  }
});

test('all response dates are validated and the oldest source timestamp represents the batch', () => {
  const snapshot = parseScoreResponses([{ ...response([aa]), meta: { as_of: '2026-10-15T00:00:00.1Z', citation: 'Source: Artificial Analysis via OpenRouter.' } }, response([gpqa])], true, DATE);
  assert.equal(snapshot.asOf, '2026-10-15T00:00:00.100Z');
  assert.equal(snapshot.fetchedAt, '2026-10-17T12:00:00.000Z');
  assert.equal(snapshot.records[0].asOf, '2026-10-15T00:00:00.100Z');
  assert.equal(snapshot.records[0].citation, 'Source: Artificial Analysis via OpenRouter.');
  assert.equal(snapshot.records[3].asOf, '2026-10-17T12:00:00.000Z');
  assert.equal(snapshot.records[3].citation, undefined);
  for (const date of ['2026-02-30T12:00:00Z', 'yesterday', '2026-10-17', `${DATE}\n`, '2026-10-17T24:00:00Z']) {
    assert.throws(() => parseScoreResponses([response([], date)], false, DATE), /timestamp/);
  }
  assert.throws(() => parseScoreResponses([response([gpqa]), response([], '2099-01-01T00:00:00Z')], false, DATE), /Future/);
});

test('malformed selected rows and out-of-range scores fail the batch rather than yielding misleading charts', () => {
  for (const accuracy of [-0.01, 1.01, '0.5', NaN, Infinity]) {
    assert.throws(() => parseScoreResponses([response([{ ...gpqa, accuracy }])], false, DATE), /number/);
  }
  assert.equal(parseScoreResponses([response([{ ...aa, intelligence_index: 112.5 }])], true, DATE).records[0].value, 112.5);
  for (const intelligence_index of [-1, Infinity, NaN, '71']) {
    assert.throws(() => parseScoreResponses([response([{ ...aa, intelligence_index }])], true, DATE), /number/);
  }
  for (const total_tasks of [0, -1, 1.2, Infinity, undefined]) {
    assert.throws(() => parseScoreResponses([response([{ ...gpqa, total_tasks }])], false, DATE));
  }
  for (const row of [null, [], { ...gpqa, accuracy_stddev: -1 }, { ...gpqa, display_name: 'x'.repeat(201) }, { ...gpqa, model_permaslug: '__proto__' }, { ...gpqa, model_permaslug: 'constructor/model' }, { ...gpqa, model_permaslug: 'vendor/model?key=secret' }]) {
    assert.throws(() => parseScoreResponses([response([row])], true, DATE));
  }
});

test('duplicates are ambiguous even when values match, and malformed caches are rejected', () => {
  assert.throws(() => parseScoreResponses([response([gpqa, gpqa])], false, DATE), /duplicate/);
  assert.throws(() => parseScoreResponses([response([aa]), response([aa])], true, DATE), /duplicate/);
  const snapshot = parseScoreResponses([response([gpqa])], false, DATE);
  for (const changed of [null, {}, { ...snapshot, records: {} }, { ...snapshot, records: [{ ...snapshot.records[0], metric: '__proto__' }] }, { ...snapshot, records: [{ ...snapshot.records[0], sampleSize: undefined }] }, { ...snapshot, includesComposites: false, records: [{ modelId: 'vendor/example', modelName: 'Example', metric: 'coding', value: 50 }] }]) {
    assert.throws(() => parseScoreSnapshot(changed));
  }
  assert.throws(() => parseScoreResponses([], false, DATE));
  assert.throws(() => parseScoreResponses([response(Array(10_001).fill(gpqa))], false, DATE));
  assert.deepEqual(parseScoreSnapshot(snapshot), snapshot);
});
