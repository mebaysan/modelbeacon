import { randomUUID } from 'node:crypto';
import { readLimitedText } from './catalog-store.ts';
import type { CatalogStorage } from './catalog-store.ts';
import { compareCatalogRevision, isSafeExternalUrl, parseCatalog } from './core.ts';
import type { Catalog, CatalogModel, ExtraCatalogSummary } from './types.ts';

const KEY = 'extraCatalogs.v1';
const DAY = 86_400_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CATALOGS = 10;

interface Entry {
  id: string;
  label: string;
  kind: 'url' | 'file';
  url?: string;
  catalog: Catalog;
  etag?: string;
  attemptedAt: number;
  message: string;
}

function normalizedUrl(value: string): string {
  if (!isSafeExternalUrl(value)) throw new Error('Catalog URL must use HTTPS without credentials.');
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

function catalogFromText(text: string, now: number): Catalog {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('Catalog exceeds the 2 MiB size limit.');
  let catalog: Catalog;
  try { catalog = parseCatalog(JSON.parse(text)); }
  catch { throw new Error('Catalog must be valid ModelBeacon catalog JSON (schema version 1 or 2).'); }
  if (Date.parse(catalog.syncedAt ?? catalog.reviewedAt) > now + DAY) throw new Error('Catalog has a future date.');
  return catalog;
}

export class ExtraCatalogStore {
  message = 'Extra catalogs are saved only on this device. Built-in model identities take precedence.';
  private entries: Entry[] = [];
  private writes: Promise<void> = Promise.resolve();
  private refreshing?: Promise<void>;
  private readonly storage: CatalogStorage;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(storage: CatalogStorage, fetcher = fetch, now = Date.now) {
    this.storage = storage;
    this.fetcher = fetcher;
    this.now = now;
    try {
      const saved = storage.get<unknown>(KEY);
      if (saved === undefined) return;
      if (!Array.isArray(saved) || saved.length > MAX_CATALOGS) throw new Error('Invalid cache.');
      for (const value of saved) {
        try {
          if (!value || typeof value !== 'object' || !/^[a-f0-9-]{36}$/.test(value.id)
            || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 200
            || (value.kind !== 'url' && value.kind !== 'file')) throw new Error('Invalid entry.');
          const url = value.kind === 'url' ? normalizedUrl(value.url) : undefined;
          if (this.entries.some(entry => entry.id === value.id || (url && entry.url === url)
            || (value.kind === 'file' && entry.kind === 'file' && entry.label === value.label))) throw new Error('Duplicate entry.');
          this.entries.push({
            id: value.id, label: url ? new URL(url).hostname : value.label, kind: value.kind, url,
            catalog: catalogFromText(JSON.stringify(value.catalog), now()),
            etag: typeof value.etag === 'string' && value.etag.length <= 512 ? value.etag : undefined,
            attemptedAt: Number.isFinite(value.attemptedAt) && value.attemptedAt >= 0 && value.attemptedAt <= now() ? value.attemptedAt : 0,
            message: 'Using the catalog snapshot saved on this device.',
          });
        } catch { this.message = 'Some saved extra catalogs were invalid and have been ignored.'; }
      }
    } catch { this.message = 'Saved extra catalogs could not be read. Add them again to restore them.'; }
  }

  async addUrl(value: string): Promise<void> {
    const url = normalizedUrl(value);
    this.checkRoom('url', url);
    let next: { catalog: Catalog; etag?: string };
    try { next = await this.download(url); }
    catch { throw new Error('Could not add the URL. It must serve valid ModelBeacon catalog JSON directly over HTTPS, within 2 MiB.'); }
    await this.enqueue(async () => {
      this.checkRoom('url', url);
      this.entries.push({ id: randomUUID(), label: new URL(url).hostname, kind: 'url', url, ...next,
        attemptedAt: this.now(), message: 'Downloaded and saved on this device.' });
      await this.save('URL catalog appended.');
    });
  }

  async addFile(name: string, text: string): Promise<void> {
    const label = name.split(/[/\\]/).at(-1)?.trim();
    if (!label || label.length > 200) throw new Error('Catalog file name must contain 1 to 200 characters.');
    const catalog = catalogFromText(text, this.now());
    await this.enqueue(async () => {
      this.checkRoom('file', label);
      this.entries.push({ id: randomUUID(), label, kind: 'file', catalog, attemptedAt: 0,
        message: 'Imported snapshot. Remove and import again to pick up file changes.' });
      await this.save('File catalog appended as a local snapshot.');
    });
  }

  async remove(id: string): Promise<void> {
    await this.enqueue(async () => {
      this.entries = this.entries.filter(entry => entry.id !== id);
      await this.save('Extra catalog removed.');
    });
  }

  refresh(force = false): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = Promise.all(this.entries.filter(entry => entry.kind === 'url'
      && (force || !entry.attemptedAt || this.now() - entry.attemptedAt >= DAY)).map(async entry => {
      entry.attemptedAt = this.now();
      let next: { catalog: Catalog; etag?: string } | undefined;
      try {
        next = await this.download(entry.url!, entry);
        if (compareCatalogRevision(next.catalog, entry.catalog) < 0) throw new Error('Catalog revision went backwards.');
      } catch { next = undefined; }
      await this.enqueue(async () => {
        if (!this.entries.includes(entry)) return;
        if (next) Object.assign(entry, next);
        entry.message = next ? 'Checked successfully; using the latest validated snapshot.' : 'Update unavailable. Keeping the last saved catalog.';
        await this.save(next ? 'Extra URL catalogs checked.' : 'An extra catalog could not be updated; its saved snapshot remains available.');
      });
    })).then(() => {}).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  view(base: Catalog): { catalog: Catalog; entries: ExtraCatalogSummary[] } {
    const catalog: Catalog = { ...base, models: [...base.models], sources: [...base.sources], benchmarks: [...base.benchmarks] };
    const modelIds = new Set(base.models.map(model => model.id));
    const aliases = new Map<string, Set<string | undefined>>();
    const rememberAliases = (model: CatalogModel) => {
      for (const alias of model.aliases) {
        const versions = aliases.get(alias.id) ?? new Set<string | undefined>();
        versions.add(alias.version);
        aliases.set(alias.id, versions);
      }
    };
    base.models.forEach(rememberAliases);
    const sourceIds = new Set(base.sources.map(source => source.id));
    const benchmarkIds = new Set(base.benchmarks.map(observation => observation.id));
    const groups = new Set(base.benchmarks.flatMap(observation => observation.comparisonGroup ? [observation.comparisonGroup] : []));
    const unique = (id: string, used: Set<string>) => {
      while (used.has(id)) id += '_';
      used.add(id);
      return id;
    };
    const entries = this.entries.map(entry => {
      const added = new Set<string>();
      const sources = new Map(entry.catalog.sources.map((source, index) => [source.id, unique(`${entry.id}:s${index}`, sourceIds)]));
      for (const model of entry.catalog.models) {
        if (modelIds.has(model.id) || model.aliases.some(alias => {
          const versions = aliases.get(alias.id);
          return versions && (alias.version === undefined || versions.has(undefined) || versions.has(alias.version));
        })) continue;
        modelIds.add(model.id);
        added.add(model.id);
        rememberAliases(model);
        catalog.models.push({ ...model, catalogLabel: entry.label, catalogReviewedAt: entry.catalog.reviewedAt,
          facts: model.facts.map(fact => ({ ...fact, sourceId: sources.get(fact.sourceId)! })),
          guidance: model.guidance.map(guidance => ({ ...guidance, sourceId: sources.get(guidance.sourceId)! })),
          ...(model.pricing ? { pricing: { ...model.pricing, sourceId: sources.get(model.pricing.sourceId)! } } : {}),
        });
      }
      if (added.size) {
        if (entry.catalog.schemaVersion === 2) catalog.schemaVersion = 2;
        catalog.sources.push(...entry.catalog.sources.map(source => ({ ...source, id: sources.get(source.id)! })));
        const comparisonGroups = new Map<string, string>();
        for (const [index, observation] of entry.catalog.benchmarks.entries()) {
          if (!added.has(observation.modelId)) continue;
          const group = observation.comparisonGroup;
          if (group && !comparisonGroups.has(group)) comparisonGroups.set(group, unique(`${entry.id}:g${comparisonGroups.size}`, groups));
          catalog.benchmarks.push({ ...observation, id: unique(`${entry.id}:b${index}`, benchmarkIds),
            sourceId: sources.get(observation.sourceId)!, comparisonGroup: group ? comparisonGroups.get(group) : undefined });
        }
      }
      return { id: entry.id, label: entry.label, kind: entry.kind, modelCount: entry.catalog.models.length,
        addedModelCount: added.size, ignoredModelCount: entry.catalog.models.length - added.size,
        revision: entry.catalog.revision, reviewedAt: entry.catalog.reviewedAt, syncedAt: entry.catalog.syncedAt, message: entry.message };
    });
    return { catalog, entries };
  }

  private checkRoom(kind: Entry['kind'], identity: string): void {
    if (this.entries.some(entry => entry.kind === kind && (kind === 'url' ? entry.url : entry.label) === identity)) {
      throw new Error('This catalog is already added. Remove it before importing it again.');
    }
    if (this.entries.length >= MAX_CATALOGS) throw new Error('Up to 10 extra catalogs can be saved. Remove one before adding another.');
  }

  private async download(url: string, current?: Entry): Promise<{ catalog: Catalog; etag?: string }> {
    const response = await this.fetcher(url, { headers: current?.etag ? { 'If-None-Match': current.etag } : {},
      signal: AbortSignal.timeout(10_000), redirect: 'error', credentials: 'omit' });
    if (response.status === 304 && current?.etag) return { catalog: current.catalog, etag: current.etag };
    if (!response.ok) throw new Error('Catalog download failed.');
    const catalog = catalogFromText(await readLimitedText(response), this.now());
    const etag = response.headers.get('etag');
    return { catalog, etag: etag && etag.length <= 512 ? etag : undefined };
  }

  private async save(message: string): Promise<void> {
    this.message = message;
    try { await this.storage.update(KEY, structuredClone(this.entries)); }
    catch { this.message += ' Changes could not be saved on this device; removed catalogs may return after restart.'; }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.writes.then(operation);
    this.writes = result.catch(() => {});
    return result;
  }
}
