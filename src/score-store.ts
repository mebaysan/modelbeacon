import type { CatalogStorage } from './catalog-store.ts';
import { parseScoreResponses, parseScoreSnapshot } from './scores.ts';
import type { ScoreSnapshot } from './types.ts';

const KEY = 'scoreCache.v1';
const MAX_BYTES = 2 * 1024 * 1024;
const ENDPOINT = 'https://openrouter.ai/api/v1/benchmarks';

class HttpError extends Error {
  readonly status: number;
  constructor(status: number) { super('Benchmark request failed.'); this.status = status; }
}

export class ScoreStore {
  snapshot?: ScoreSnapshot;
  message = 'Connect OpenRouter to fetch published scores. No scores have been downloaded.';
  private generation = 0;
  private pending?: Promise<void>;
  private controller?: AbortController;
  private writes: Promise<void> = Promise.resolve();
  private readonly storage: CatalogStorage;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(storage: CatalogStorage, fetcher = fetch, now = Date.now) {
    this.storage = storage;
    this.fetcher = fetcher;
    this.now = now;
    try {
      const cached = storage.get<unknown>(KEY);
      if (cached !== undefined) {
        const snapshot = parseScoreSnapshot(cached);
        validateDates(snapshot, this.now());
        this.snapshot = snapshot;
        this.message = 'Using published scores saved on this device. Refresh to check for updates.';
      }
    } catch {
      this.message = 'Saved scores could not be read. Refresh to rebuild the local cache.';
    }
  }

  refresh(apiKey: string, includeComposites: boolean): Promise<void> {
    if (this.pending) return this.pending;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const pending = this.download(apiKey, includeComposites, generation, controller.signal).finally(() => {
      if (this.pending === pending) { this.pending = undefined; this.controller = undefined; }
    });
    this.pending = pending;
    return pending;
  }

  private async download(apiKey: string, includeComposites: boolean, generation: number, signal: AbortSignal): Promise<void> {
    try {
      if (!apiKey.trim() || apiKey.length > 512 || /[\r\n]/.test(apiKey)) throw new HttpError(401);
      const queries = ['source=openrouter&benchmark_type=gpqa_diamond', 'source=openrouter&benchmark_type=tau_bench_verified_airline'];
      if (includeComposites) queries.push('source=artificial-analysis');
      const responses = [];
      for (const query of queries) {
        if (generation !== this.generation) return;
        const response = await this.fetcher(`${ENDPOINT}?${query}`, {
          method: 'GET', headers: { Authorization: `Bearer ${apiKey}` },
          redirect: 'error', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) { await response.body?.cancel(); throw new HttpError(response.status); }
        responses.push(JSON.parse(await readLimitedText(response)));
      }
      const snapshot = parseScoreResponses(responses, includeComposites, new Date(this.now()).toISOString());
      validateDates(snapshot, this.now());
      if (generation !== this.generation) return;
      this.snapshot = snapshot;
      this.message = `Updated ${snapshot.records.length} published scores from OpenRouter.`;
      await this.enqueue(async () => {
        if (generation !== this.generation) return;
        try { await this.storage.update(KEY, snapshot); }
        catch {
          if (generation === this.generation) this.message += ' Scores are available for this session but could not be saved on this device.';
        }
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const reason = error instanceof HttpError && [401, 403].includes(error.status)
        ? 'OpenRouter did not accept the API key. Reconnect with a valid key.'
        : error instanceof HttpError && error.status === 429
          ? 'OpenRouter rate limit reached. Try again later.'
          : 'Scores could not be refreshed. Check your connection or try again later.';
      this.message = `${reason} ${this.snapshot ? 'Keeping the previously saved scores.' : 'No scores are available yet.'}`;
    }
  }

  async clear(): Promise<boolean> {
    const generation = ++this.generation;
    this.controller?.abort();
    this.controller = undefined;
    this.pending = undefined;
    this.snapshot = undefined;
    let cleared = false;
    await this.enqueue(async () => {
      try {
        await this.storage.update(KEY, undefined);
        cleared = true;
        if (generation === this.generation) this.message = 'Published scores cleared from this device.';
      } catch {
        if (generation === this.generation) this.message = 'Scores cleared for this session, but saved scores could not be removed. They may return after restarting VS Code. Try clearing again.';
      }
    });
    return cleared;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.writes.then(operation);
    this.writes = result.catch(() => {});
    return result;
  }
}

function validateDates(snapshot: ScoreSnapshot, now: number): void {
  const latest = now + 86_400_000;
  if (Date.parse(snapshot.asOf) > latest || Date.parse(snapshot.fetchedAt) > latest
    || snapshot.records.some(record => (record.asOf && Date.parse(record.asOf) > latest)
      || (record.evaluatedAt && Date.parse(record.evaluatedAt) > latest))) {
    throw new Error('Future benchmark date.');
  }
}

async function readLimitedText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Benchmark response exceeds size limit.');
  }
  if (!response.body) throw new Error('Empty benchmark response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Benchmark response exceeds size limit.'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
