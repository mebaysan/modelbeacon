import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScoreResponses, parseScoreSnapshot, SCORE_METRICS } from '../src/scores.ts';

const DATE = '2026-10-17T12:00:00Z';
const aa = { source: 'artificial-analysis', model_permaslug: 'openai/example-1', display_name: 'Example 1', intelligence_index: 71.2, coding_index: 65.8, agentic_index: 58.3 };
const gpqa = { source: 'openrouter', model_permaslug: 'openai/example-1', display_name: 'Example 1', benchmark_type: 'gpqa_diamond', accuracy: 0.72, accuracy_stddev: 0.03, total_tasks: 300, last_run_timestamp: DATE };
function response(data: unknown[], asOf = DATE) { return { data, meta: { as_of: asOf } }; }

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

test('API-only fields, prices and arbitrary response URLs never enter the cache', () => {
  const snapshot = parseScoreResponses([response([{ ...aa, api_key: 'private', pricing: { prompt: '0.1' } }, { ...gpqa, avg_cost_per_task: 10 }])], true, DATE);
  const parsed = parseScoreSnapshot({ ...snapshot, key: 'secret', records: snapshot.records.map(row => ({ ...row, endpoint: 'private' })) });
  assert.deepEqual(parsed, snapshot);
  assert.doesNotMatch(JSON.stringify(parsed), /private|secret|pricing|avg_cost|endpoint/);
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
