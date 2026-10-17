import type { ModelScore, ScoreMetric, ScoreSnapshot } from './types.ts';

const API_DOCS = 'https://openrouter.ai/docs/api/api-reference/benchmarks/list-benchmarks';
const AA_METHOD = 'https://artificialanalysis.ai/methodology/intelligence-benchmarking';

export const SCORE_METRICS: Record<ScoreMetric, {
  label: string; unit: 'points' | '%'; source: string; sourceUrl: string; composite: boolean;
}> = {
  intelligence: { label: 'Intelligence Index', unit: 'points', source: 'Artificial Analysis via OpenRouter', sourceUrl: AA_METHOD, composite: true },
  coding: { label: 'Coding Index', unit: 'points', source: 'Artificial Analysis via OpenRouter', sourceUrl: API_DOCS, composite: true },
  agentic: { label: 'Agentic Index', unit: 'points', source: 'Artificial Analysis via OpenRouter', sourceUrl: API_DOCS, composite: true },
  gpqa: { label: 'GPQA Diamond', unit: '%', source: 'OpenRouter', sourceUrl: API_DOCS, composite: false },
  toolUse: { label: 'τ-bench verified airline', unit: '%', source: 'OpenRouter', sourceUrl: API_DOCS, composite: false },
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid benchmark data.');
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Invalid benchmark text.');
  }
  return value;
}

function modelId(value: unknown): string {
  const id = text(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:+-]*$/.test(id)
    || id.split('/').some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) {
    throw new Error('Invalid benchmark model identity.');
  }
  return id;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new Error('Invalid benchmark timestamp.');
  const canonical = new Date(value).toISOString();
  if (canonical !== value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`)) {
    throw new Error('Invalid benchmark timestamp.');
  }
  return canonical;
}

function number(value: unknown, max = Number.MAX_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error('Invalid benchmark number.');
  }
  return value;
}

function count(value: unknown): number {
  const result = number(value, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('Invalid benchmark sample size.');
  return result;
}

export function parseScoreResponses(responses: unknown[], includeComposites: boolean, fetchedAt: string): ScoreSnapshot {
  if (!Array.isArray(responses) || responses.length < 1 || responses.length > 3) throw new Error('Invalid benchmark responses.');
  const latest = Date.parse(timestamp(fetchedAt)) + 86_400_000;
  const records: ModelScore[] = [];
  const dates: string[] = [];
  for (const input of responses) {
    const response = object(input);
    const meta = object(response.meta);
    const asOf = timestamp(meta.as_of);
    if (Date.parse(asOf) > latest) throw new Error('Future benchmark source date.');
    dates.push(asOf);
    const provenance = { asOf, ...(meta.citation == null ? {} : { citation: text(meta.citation, 1_000) }) };
    if (!Array.isArray(response.data) || response.data.length > 10_000) throw new Error('Invalid benchmark rows.');
    for (const raw of response.data) {
      const row = object(raw);
      if (row.source === 'artificial-analysis' && includeComposites) {
        const identity = { modelId: modelId(row.model_permaslug), modelName: text(row.display_name), ...provenance };
        for (const [field, metric] of [['intelligence_index', 'intelligence'], ['coding_index', 'coding'], ['agentic_index', 'agentic']] as const) {
          if (row[field] != null) records.push({ ...identity, metric, value: number(row[field]) });
        }
      } else if (row.source === 'openrouter' && ['gpqa_diamond', 'tau_bench_verified_airline'].includes(String(row.benchmark_type))) {
        const identity = { modelId: modelId(row.model_permaslug), modelName: text(row.display_name), ...provenance };
        if (row.accuracy == null) continue;
        records.push({ ...identity, metric: row.benchmark_type === 'gpqa_diamond' ? 'gpqa' : 'toolUse',
          value: number(row.accuracy, 1) * 100,
          sampleSize: count(row.total_tasks), evaluatedAt: timestamp(row.last_run_timestamp),
          ...(row.accuracy_stddev == null ? {} : { standardDeviation: number(row.accuracy_stddev, 1) * 100 }),
        });
      }
    }
  }
  // The oldest source timestamp avoids presenting a partially older batch as entirely fresh.
  return parseScoreSnapshot({ asOf: dates.sort()[0], fetchedAt, includesComposites: includeComposites, records });
}

export function parseScoreSnapshot(input: unknown): ScoreSnapshot {
  const value = object(input);
  const asOf = timestamp(value.asOf);
  const fetchedAt = timestamp(value.fetchedAt);
  if (typeof value.includesComposites !== 'boolean' || !Array.isArray(value.records) || value.records.length > 30_000) {
    throw new Error('Invalid saved benchmark scores.');
  }
  const seen = new Set<string>();
  const records = value.records.map(raw => {
    const row = object(raw);
    if (typeof row.metric !== 'string' || !Object.hasOwn(SCORE_METRICS, row.metric)) throw new Error('Invalid benchmark metric.');
    const metric = row.metric as ScoreMetric;
    if (!value.includesComposites && SCORE_METRICS[metric].composite) throw new Error('Unexpected composite benchmark.');
    const record: ModelScore = { modelId: modelId(row.modelId), modelName: text(row.modelName), metric, value: number(row.value, SCORE_METRICS[metric].composite ? Number.MAX_VALUE : 100) };
    if (row.asOf !== undefined) record.asOf = timestamp(row.asOf);
    if (row.citation !== undefined) record.citation = text(row.citation, 1_000);
    if (row.evaluatedAt !== undefined) record.evaluatedAt = timestamp(row.evaluatedAt);
    if (row.sampleSize !== undefined) record.sampleSize = count(row.sampleSize);
    if (row.standardDeviation !== undefined) record.standardDeviation = number(row.standardDeviation, 100);
    if (!SCORE_METRICS[metric].composite && (!record.evaluatedAt || record.sampleSize === undefined)) {
      throw new Error('Missing benchmark evaluation metadata.');
    }
    if (SCORE_METRICS[metric].composite && (record.sampleSize !== undefined || record.standardDeviation !== undefined)) {
      throw new Error('Unexpected composite benchmark uncertainty.');
    }
    const key = `${record.modelId}/${metric}`;
    if (seen.has(key)) throw new Error('Ambiguous duplicate benchmark scores.');
    seen.add(key);
    return record;
  });
  return { asOf, fetchedAt, includesComposites: value.includesComposites, records };
}
