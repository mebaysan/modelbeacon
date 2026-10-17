import { parseCatalog, isSafeExternalUrl, compareCatalogRevision } from './core.ts';
import type { Catalog, ExplorerState } from './types.ts';

const DAY = 24 * 60 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const KEY = 'catalogCache.v1';

export interface CatalogStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

interface Cache {
  catalog: Catalog;
  url: string;
  etag?: string;
  attemptedAt: number;
}

export class CatalogStore {
  catalog: Catalog;
  origin: ExplorerState['catalogOrigin'] = 'bundled';
  message = 'Bundled catalog. Published guidance does not measure your Copilot session.';
  private etag?: string;
  private attemptedAt = 0;
  private pending?: Promise<void>;
  private readonly storage: CatalogStorage;
  private readonly url: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(bundled: unknown, storage: CatalogStorage, url: string, fetcher = fetch, now = Date.now) {
    this.catalog = parseCatalog(bundled);
    this.storage = storage;
    this.url = url;
    this.fetcher = fetcher;
    this.now = now;
    const cache = storage.get<Cache>(KEY);
    if (cache?.url === url) {
      try {
        const catalog = parseCatalog(cache.catalog);
        if (compareCatalogRevision(catalog, this.catalog) >= 0) {
          this.catalog = catalog;
          this.origin = 'cached';
          this.message = 'Using the last validated catalog saved on this device.';
          this.etag = typeof cache.etag === 'string' && cache.etag.length <= 512 ? cache.etag : undefined;
          this.attemptedAt = Number.isFinite(cache.attemptedAt) && cache.attemptedAt <= now() ? cache.attemptedAt : 0;
        }
      } catch {
        this.message = 'Saved catalog was invalid. Using the bundled catalog.';
      }
    }
    if (!url) this.message = 'This local build uses bundled data. Online updates become available in a release built with a published catalog URL.';
  }

  refresh(force = false): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.url) return Promise.resolve();
    if (!force && this.attemptedAt > 0 && this.now() - this.attemptedAt < DAY) return Promise.resolve();
    this.pending = this.download().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async download(): Promise<void> {
    this.attemptedAt = this.now();
    try {
      if (!isSafeExternalUrl(this.url)) throw new Error('Catalog endpoint must use HTTPS.');
      const response = await this.fetcher(this.url, {
        headers: this.etag ? { 'If-None-Match': this.etag } : {},
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
        credentials: 'omit',
      });
      if (response.status === 304) {
        if (!this.etag) throw new Error('Server returned no catalog.');
        this.message = 'Catalog checked; your saved revision is current.';
      } else {
        if (!response.ok) throw new Error(`Catalog server returned HTTP ${response.status}.`);
        const next = parseCatalog(JSON.parse(await readLimitedText(response)));
        if (compareCatalogRevision(next, this.catalog) < 0) throw new Error('Server catalog is older than the current catalog.');
        if (Date.parse(next.reviewedAt) > this.now() + DAY) throw new Error('Server catalog has a future review date.');
        this.catalog = next;
        this.origin = 'online';
        const etag = response.headers.get('etag');
        this.etag = etag && etag.length <= 512 ? etag : undefined;
        this.message = 'Updated from the published catalog. Review date and evaluation dates are shown separately.';
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Request failed.';
      this.message = `Catalog update unavailable. Keeping the ${this.origin} catalog. ${reason}`;
    }
    try {
      await this.storage.update(KEY, { catalog: this.catalog, url: this.url, etag: this.etag, attemptedAt: this.attemptedAt } satisfies Cache);
    } catch {
      this.message += ' The catalog could not be saved; it remains available for this session.';
    }
  }
}

async function readLimitedText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Catalog exceeds the 2 MiB size limit.');
  }
  if (!response.body) throw new Error('Catalog response was empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Catalog exceeds the 2 MiB size limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
