import type {
  BenchmarkObservation, Catalog, CatalogModel, DiscoveredModel,
  TaskId, WebviewRequest,
} from './types.ts';

const DAY_MS = 86_400_000;
const TASKS: TaskId[] = ['everyday', 'debugging', 'agentic', 'visual'];

function invalid(path: string, reason: string): never {
  throw new Error(`Invalid catalog: ${path} ${reason}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'must be an object');
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, max = 4_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    invalid(path, `must be a nonempty string of at most ${max} characters`);
  }
  return value;
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(path, `must be an array of at most ${max} items`);
  return value;
}

function number(value: unknown, path: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    invalid(path, `must be a finite number between 0 and ${max}`);
  }
  return value;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function date(value: unknown, path: string): void {
  if (!validDate(value)) invalid(path, 'must be a real calendar date in YYYY-MM-DD format');
}

export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function uniqueId(value: unknown, path: string, ids: Set<string>): string {
  const id = text(value, path, 200);
  if (ids.has(id)) invalid(path, `duplicates ID ${id}`);
  ids.add(id);
  return id;
}

function reference(value: unknown, path: string, ids: Set<string>): void {
  const id = text(value, path, 200);
  if (!ids.has(id)) invalid(path, `references unknown ID ${id}`);
}

/** Validate every field used by the host or renderer before accepting downloaded data. */
export function parseCatalog(input: unknown): Catalog {
  const catalog = record(input, 'catalog');
  if (catalog.schemaVersion !== 1) invalid('schemaVersion', 'must be 1');
  date(catalog.reviewedAt, 'reviewedAt');
  const revision = text(catalog.revision, 'revision', 200);
  if (!/^\d{4}-\d{2}-\d{2}\.[1-9]\d{0,6}$/.test(revision) || revision.trim() !== revision) {
    invalid('revision', 'must be YYYY-MM-DD.N with N from 1 to 9999999 and no leading zeros');
  }
  if (revision.slice(0, 10) !== catalog.reviewedAt) invalid('revision', 'date must match reviewedAt');

  const sourceIds = new Set<string>();
  for (const [index, value] of list(catalog.sources, 'sources', 500).entries()) {
    const path = `sources[${index}]`;
    const source = record(value, path);
    uniqueId(source.id, `${path}.id`, sourceIds);
    text(source.title, `${path}.title`);
    text(source.license, `${path}.license`);
    for (const key of ['url', 'licenseUrl']) {
      if (!isSafeExternalUrl(source[key])) invalid(`${path}.${key}`, 'must be an HTTPS URL without credentials');
    }
    date(source.retrievedAt, `${path}.retrievedAt`);
    if (source.revision !== undefined) text(source.revision, `${path}.revision`, 200);
  }

  const modelIds = new Set<string>();
  const aliases = new Map<string, Set<string | undefined>>();
  for (const [index, value] of list(catalog.models, 'models', 1_000).entries()) {
    const path = `models[${index}]`;
    const model = record(value, path);
    uniqueId(model.id, `${path}.id`, modelIds);
    text(model.name, `${path}.name`, 200);
    text(model.provider, `${path}.provider`, 200);
    for (const [aliasIndex, aliasValue] of list(model.aliases, `${path}.aliases`, 100).entries()) {
      const aliasPath = `${path}.aliases[${aliasIndex}]`;
      const alias = record(aliasValue, aliasPath);
      const id = text(alias.id, `${aliasPath}.id`, 200);
      const version = alias.version === undefined ? undefined : text(alias.version, `${aliasPath}.version`, 200);
      const versions = aliases.get(id);
      if (versions && (version === undefined || versions.has(undefined) || versions.has(version))) {
        invalid(aliasPath, `duplicates or overlaps alias ${id}`);
      }
      if (versions) versions.add(version);
      else aliases.set(id, new Set([version]));
    }
    for (const [factIndex, factValue] of list(model.facts, `${path}.facts`, 50).entries()) {
      const factPath = `${path}.facts[${factIndex}]`;
      const fact = record(factValue, factPath);
      text(fact.text, `${factPath}.text`);
      reference(fact.sourceId, `${factPath}.sourceId`, sourceIds);
    }
    const taskIds = new Set<string>();
    for (const [guidanceIndex, guidanceValue] of list(model.guidance, `${path}.guidance`, 4).entries()) {
      const guidancePath = `${path}.guidance[${guidanceIndex}]`;
      const guidance = record(guidanceValue, guidancePath);
      const task = uniqueId(guidance.task, `${guidancePath}.task`, taskIds);
      if (!TASKS.includes(task as TaskId)) invalid(`${guidancePath}.task`, 'must be a supported task');
      text(guidance.rationale, `${guidancePath}.rationale`);
      text(guidance.limitation, `${guidancePath}.limitation`);
      reference(guidance.sourceId, `${guidancePath}.sourceId`, sourceIds);
    }
    if (model.pricing !== undefined) {
      const pricingPath = `${path}.pricing`;
      const pricing = record(model.pricing, pricingPath);
      reference(pricing.sourceId, `${pricingPath}.sourceId`, sourceIds);
      date(pricing.reviewedAt, `${pricingPath}.reviewedAt`);
      if (pricing.validThrough !== undefined) date(pricing.validThrough, `${pricingPath}.validThrough`);
      const tiers = list(pricing.tiers, `${pricingPath}.tiers`, 8);
      if (!tiers.length) invalid(`${pricingPath}.tiers`, 'must contain at least one tier');
      for (const [tierIndex, tierValue] of tiers.entries()) {
        const tierPath = `${pricingPath}.tiers[${tierIndex}]`;
        const tier = record(tierValue, tierPath);
        text(tier.name, `${tierPath}.name`, 200);
        number(tier.inputUsdPerMillion, `${tierPath}.inputUsdPerMillion`);
        number(tier.outputUsdPerMillion, `${tierPath}.outputUsdPerMillion`);
        for (const key of ['cachedInputUsdPerMillion', 'cacheWriteUsdPerMillion']) {
          if (tier[key] !== undefined) number(tier[key], `${tierPath}.${key}`);
        }
        if (tier.threshold !== undefined) text(tier.threshold, `${tierPath}.threshold`);
      }
    }
  }

  const observationIds = new Set<string>();
  for (const [index, value] of list(catalog.benchmarks, 'benchmarks', 5_000).entries()) {
    const path = `benchmarks[${index}]`;
    const observation = record(value, path);
    uniqueId(observation.id, `${path}.id`, observationIds);
    reference(observation.modelId, `${path}.modelId`, modelIds);
    reference(observation.sourceId, `${path}.sourceId`, sourceIds);
    for (const key of ['benchmark', 'benchmarkVersion', 'agent', 'agentVersion', 'reasoningEffort']) {
      text(observation[key], `${path}.${key}`, 200);
    }
    number(observation.accuracy, `${path}.accuracy`, 100);
    if (observation.ci95 !== undefined) number(observation.ci95, `${path}.ci95`, 100);
    const trials = number(observation.trials, `${path}.trials`);
    if (!Number.isSafeInteger(trials) || trials < 1) invalid(`${path}.trials`, 'must be a positive integer');
    for (const key of ['modelReleasedAt', 'submittedAt', 'evaluatedAt']) {
      if (observation[key] !== undefined) date(observation[key], `${path}.${key}`);
    }
    if (observation.comparisonGroup !== undefined) text(observation.comparisonGroup, `${path}.comparisonGroup`, 200);
  }
  return input as Catalog;
}

export function compareCatalogRevision(a: Catalog, b: Catalog): number {
  if (a.reviewedAt !== b.reviewedAt) return a.reviewedAt < b.reviewedAt ? -1 : 1;
  return Number(a.revision.slice(11)) - Number(b.revision.slice(11));
}

export function runtimeKey(model: Pick<DiscoveredModel, 'vendor' | 'id' | 'version'>): string {
  return `runtime:${JSON.stringify([model.vendor, model.id, model.version])}`;
}

export function matchModel(runtime: DiscoveredModel, catalog: Catalog): CatalogModel | undefined {
  if (runtime.vendor !== 'copilot') return undefined;
  const matches = catalog.models.filter(model => model.aliases.some(alias => alias.id === runtime.id
    && (alias.version === undefined || alias.version === runtime.version)));
  return matches.length === 1 ? matches[0] : undefined;
}

export function recommendations(
  catalog: Catalog, task: TaskId, discovered: DiscoveredModel[], onlyAvailable: boolean,
): CatalogModel[] {
  const available = new Set(discovered.map(model => matchModel(model, catalog)?.id));
  return catalog.models
    .filter(model => model.guidance.some(guidance => guidance.task === task)
      && (!onlyAvailable || available.has(model.id)))
    // Catalog order is editorial selection; alphabetical order is only presentation.
    .slice(0, 3)
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
}

export function areComparable(observations: BenchmarkObservation[]): boolean {
  const first = observations[0];
  if (observations.length < 2 || !first?.comparisonGroup?.trim()) return false;
  const keys = ['comparisonGroup', 'benchmark', 'benchmarkVersion', 'agent', 'agentVersion', 'reasoningEffort'] as const;
  return observations.every(observation => keys.every(key => observation[key] === first[key]));
}

export function isStale(reviewedAt: string, now = Date.now()): boolean {
  return !validDate(reviewedAt) || now - Date.parse(reviewedAt) > 14 * DAY_MS;
}

export function activePricing(model: CatalogModel, now = Date.now()): CatalogModel['pricing'] {
  const pricing = model.pricing;
  if (pricing?.validThrough !== undefined
    && (!validDate(pricing.validThrough) || now >= Date.parse(pricing.validThrough) + DAY_MS)) return undefined;
  return pricing;
}

export function isWebviewRequest(value: unknown): value is WebviewRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  const keys = Object.keys(request);
  switch (request.type) {
    case 'ready':
    case 'detectModels':
    case 'clearLocalModels':
    case 'refreshCatalog':
    case 'openPicker':
    case 'connectScores':
    case 'refreshScores':
    case 'clearScores':
      return keys.length === 1;
    case 'showScores':
    case 'linkScores':
    case 'unlinkScores':
      return keys.length === 2 && typeof request.key === 'string'
        && request.key.length > 0 && request.key.length <= 1800;
    case 'openScoreSource':
      return keys.length === 2 && ['intelligence', 'coding', 'agentic', 'gpqa', 'toolUse'].includes(request.metric as string);
    case 'openSource':
      return keys.length === 2 && typeof request.sourceId === 'string'
        && !!request.sourceId.trim() && request.sourceId.length <= 200;
    case 'openHelp':
      return keys.length === 2 && ['auto', 'legacy', 'signin'].includes(request.topic as string);
    case 'setAutoUpdate':
    case 'setCompositeScores':
      return keys.length === 2 && typeof request.enabled === 'boolean';
    default:
      return false;
  }
}
