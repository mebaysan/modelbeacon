export type TaskId = 'everyday' | 'debugging' | 'agentic' | 'visual';

export interface Source {
  id: string;
  title: string;
  url: string;
  license: string;
  licenseUrl: string;
  retrievedAt: string;
  revision?: string;
}

export interface Guidance {
  task: TaskId;
  rationale: string;
  limitation: string;
  sourceId: string;
}

export interface PriceTier {
  name: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  threshold?: string;
}

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  aliases: { id: string; version?: string }[];
  facts: { text: string; sourceId: string }[];
  guidance: Guidance[];
  pricing?: {
    sourceId: string;
    reviewedAt: string;
    validThrough?: string;
    tiers: PriceTier[];
  };
}

export interface BenchmarkObservation {
  id: string;
  modelId: string;
  benchmark: string;
  benchmarkVersion: string;
  agent: string;
  agentVersion: string;
  reasoningEffort: string;
  accuracy: number;
  ci95?: number;
  trials: number;
  sourceId: string;
  modelReleasedAt?: string;
  submittedAt?: string;
  evaluatedAt?: string;
  // Only assign a group after reviewing complete compatible run configurations.
  comparisonGroup?: string;
}

export interface Catalog {
  schemaVersion: 1;
  revision: string;
  reviewedAt: string;
  sources: Source[];
  models: CatalogModel[];
  benchmarks: BenchmarkObservation[];
}

export interface DiscoveredModel {
  id: string;
  name: string;
  vendor: string;
  family: string;
  version: string;
  maxInputTokens: number;
}

export interface LocalModel extends DiscoveredModel {
  lastSeen: string;
}

export type DiscoveryStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export type ScoreMetric = 'intelligence' | 'coding' | 'agentic' | 'gpqa' | 'toolUse';

export interface ModelScore {
  modelId: string;
  modelName: string;
  metric: ScoreMetric;
  value: number;
  asOf?: string;
  citation?: string;
  evaluatedAt?: string;
  sampleSize?: number;
  standardDeviation?: number;
}

export interface ScoreSnapshot {
  asOf: string;
  fetchedAt: string;
  includesComposites: boolean;
  records: ModelScore[];
}

export interface ScoreState {
  connected: boolean;
  loading: boolean;
  message: string;
  includeComposites: boolean;
  snapshot?: ScoreSnapshot;
  // Explicit, user-selected associations; runtime identities never match by name.
  links: Record<string, string>;
}

export interface ExplorerState {
  catalog: Catalog;
  catalogOrigin: 'bundled' | 'cached' | 'online';
  catalogMessage: string;
  catalogLoading: boolean;
  discovered: DiscoveredModel[];
  localModels: LocalModel[];
  localModelsMessage: string;
  discoveryStatus: DiscoveryStatus;
  discoveryMessage: string;
  autoUpdateCatalog: boolean;
  scores: ScoreState;
}

export type WebviewRequest =
  | { type: 'ready' }
  | { type: 'detectModels' }
  | { type: 'clearLocalModels' }
  | { type: 'refreshCatalog' }
  | { type: 'openPicker' }
  | { type: 'openSource'; sourceId: string }
  | { type: 'openHelp'; topic: 'auto' | 'legacy' | 'signin' }
  | { type: 'connectScores' | 'refreshScores' | 'clearScores' }
  | { type: 'showScores' | 'linkScores' | 'unlinkScores'; key: string }
  | { type: 'compareScores'; keys: string[] }
  | { type: 'setCompositeScores'; enabled: boolean }
  | { type: 'openScoreSource'; metric: ScoreMetric }
  | { type: 'setAutoUpdate'; enabled: boolean };

export type HostMessage = { type: 'state'; state: ExplorerState };
