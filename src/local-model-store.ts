import { runtimeKey } from './core.ts';
import type { CatalogStorage } from './catalog-store.ts';
import type { DiscoveredModel, LocalModel } from './types.ts';

const KEY = 'localModels.v1';
const MAX_MODELS = 1_000;

function metadataText(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > 200 || (!allowEmpty && !value.trim())) {
    throw new Error(`Invalid model metadata: ${field} must be a string of at most 200 characters${allowEmpty ? '' : ' and cannot be empty'}.`);
  }
  return value;
}

export function parseDiscoveredModels(input: unknown): DiscoveredModel[] {
  if (!Array.isArray(input) || input.length > MAX_MODELS) {
    throw new Error('Invalid model metadata: expected an array of at most 1000 models.');
  }
  return input.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Invalid model metadata: models[${index}] must be an object.`);
    }
    const model = value as Record<string, unknown>;
    const maxInputTokens = model.maxInputTokens;
    if (typeof maxInputTokens !== 'number' || !Number.isSafeInteger(maxInputTokens) || maxInputTokens < 0) {
      throw new Error(`Invalid model metadata: models[${index}].maxInputTokens must be a nonnegative safe integer.`);
    }
    return {
      id: metadataText(model.id, `models[${index}].id`),
      name: metadataText(model.name, `models[${index}].name`),
      vendor: metadataText(model.vendor, `models[${index}].vendor`),
      family: metadataText(model.family, `models[${index}].family`, true),
      version: metadataText(model.version, `models[${index}].version`, true),
      maxInputTokens,
    };
  });
}

function parseSavedModels(input: unknown): LocalModel[] {
  const models = parseDiscoveredModels(input);
  const saved = input as Record<string, unknown>[];
  const keys = new Set<string>();
  return models.map((model, index) => {
    const lastSeen = saved[index].lastSeen;
    if (typeof lastSeen !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(lastSeen)
      || !Number.isFinite(Date.parse(lastSeen)) || new Date(lastSeen).toISOString() !== lastSeen) {
      throw new Error('Invalid saved model timestamp.');
    }
    const key = runtimeKey(model);
    if (keys.has(key)) throw new Error('Duplicate saved model identity.');
    keys.add(key);
    return { ...model, lastSeen };
  });
}

export class LocalModelStore {
  models: LocalModel[] = [];
  message = 'No model metadata saved on this device.';
  private pending: Promise<void> = Promise.resolve();
  private readonly storage: CatalogStorage;
  private readonly now: () => number;

  constructor(storage: CatalogStorage, now = Date.now) {
    this.storage = storage;
    this.now = now;
    try {
      const saved = storage.get<unknown>(KEY);
      if (saved !== undefined) {
        this.models = parseSavedModels(saved);
        this.message = `Loaded ${this.models.length} saved model identities. Current availability has not been checked.`;
      }
    } catch {
      this.message = 'Saved model metadata could not be read. Detect models to rebuild it.';
    }
  }

  async remember(models: DiscoveredModel[]): Promise<void> {
    const discovered = parseDiscoveredModels(models);
    const lastSeen = new Date(this.now()).toISOString();
    await this.enqueue(async () => {
      const merged = new Map(discovered.map(model => [runtimeKey(model), { ...model, lastSeen }]));
      for (const model of this.models) {
        if (!merged.has(runtimeKey(model))) merged.set(runtimeKey(model), model);
      }
      this.models = [...merged.values()]
        .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
        .slice(0, MAX_MODELS);
      try {
        await this.storage.update(KEY, this.models);
        this.message = `Saved ${this.models.length} model identities on this device${merged.size > MAX_MODELS ? ' (the 1000 most recently seen)' : ''}. Saved metadata does not confirm current availability.`;
      } catch {
        this.message = 'Model metadata is available for this session but could not be saved on this device.';
      }
    });
  }

  async clear(): Promise<boolean> {
    let cleared = false;
    await this.enqueue(async () => {
      this.models = [];
      try {
        await this.storage.update(KEY, undefined);
        cleared = true;
        this.message = 'Saved model metadata cleared from this device.';
      } catch {
        this.message = 'Model metadata cleared for this session, but saved data could not be removed. It may return after restarting VS Code. Try clearing again.';
      }
    });
    return cleared;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }
}
