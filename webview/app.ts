import { activePricing, areComparable, isStale, matchModel, recommendations, runtimeKey } from '../src/core';
import { findScoreReference, SCORE_METRICS } from '../src/scores';
import type { BenchmarkObservation, CatalogModel, DiscoveredModel, ExplorerState, HostMessage, ModelScore, ScoreMetric, TaskId, WebviewRequest } from '../src/types';

interface ViewState {
  tab: 'choose' | 'explore';
  task: TaskId;
  filter: 'all' | 'detected';
  query: string;
  selected: string[];
}

interface RuntimeEntry {
  model: DiscoveredModel;
  detected: boolean;
  lastSeen?: string;
}

interface ComparisonEntry {
  key: string;
  name: string;
  provider: string;
  label: string;
  catalog?: CatalogModel;
  runtime?: RuntimeEntry;
}

declare function acquireVsCodeApi(): {
  getState(): unknown;
  setState(state: ViewState): void;
  postMessage(message: WebviewRequest): void;
};

const vscode = acquireVsCodeApi();
const tasks: { id: TaskId; name: string; description: string; icon: string }[] = [
  { id: 'everyday', name: 'Everyday coding', description: 'Small changes & familiar code', icon: '01' },
  { id: 'debugging', name: 'Debug & refactor', description: 'Understand, diagnose, improve', icon: '02' },
  { id: 'agentic', name: 'Larger agentic changes', description: 'Plan & work across files', icon: '03' },
  { id: 'visual', name: 'Visual & UI work', description: 'Interfaces & image context', icon: '04' },
];
const saved = vscode.getState() as Partial<ViewState> | undefined;
const view: ViewState = {
  tab: saved?.tab === 'explore' ? 'explore' : 'choose',
  task: tasks.some(task => task.id === saved?.task) ? saved!.task! : 'everyday',
  filter: saved?.filter === 'detected' ? 'detected' : 'all',
  query: typeof saved?.query === 'string' ? saved.query : '',
  selected: Array.isArray(saved?.selected) ? [...new Set(saved.selected.filter(id => typeof id === 'string'))].slice(0, 3) : [],
};
let state: ExplorerState | undefined;
let sourceCounter = 0;
const root = document.getElementById('app')!;

type Child = Node | string | undefined;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  for (const child of children) if (child !== undefined) node.append(child);
  return node;
}

function button(label: string, className: string, action: () => void, id?: string): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  if (id) node.id = id;
  node.addEventListener('click', action);
  return node;
}

function persist(): void { vscode.setState(view); }
function send(message: WebviewRequest): void { vscode.postMessage(message); }
function date(value: string): string {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
function number(value: number): string { return new Intl.NumberFormat().format(value); }
function money(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
}
function badge(label: string, tone = ''): HTMLElement { return element('span', `badge ${tone}`, label); }
function sourceLink(sourceId: string, shortLabel = 'View source'): HTMLElement {
  const source = state!.catalog.sources.find(candidate => candidate.id === sourceId);
  const link = button(shortLabel + ' ↗', 'text-button source-link', () => send({ type: 'openSource', sourceId }), `source-${++sourceCounter}`);
  link.title = source?.title ?? 'Open the source';
  link.setAttribute('aria-label', `${shortLabel}: ${source?.title ?? sourceId} (opens in browser)`);
  return link;
}

function matches(model: CatalogModel): DiscoveredModel[] {
  return state!.discovered.filter(runtime => matchModel(runtime, state!.catalog)?.id === model.id);
}

function runtimeEntries(): RuntimeEntry[] {
  const entries = new Map<string, RuntimeEntry>();
  for (const model of state!.localModels) entries.set(runtimeKey(model), { model, detected: false, lastSeen: model.lastSeen });
  for (const model of state!.discovered) entries.set(runtimeKey(model), { model, detected: true, lastSeen: entries.get(runtimeKey(model))?.lastSeen });
  return [...entries.values()];
}

function catalogRuntimes(model: CatalogModel): RuntimeEntry[] {
  return runtimeEntries().filter(entry => matchModel(entry.model, state!.catalog)?.id === model.id);
}

function catalogEntry(model: CatalogModel): ComparisonEntry {
  return { key: JSON.stringify(['catalog', model.id]), name: model.name, provider: model.provider, label: model.name, catalog: model };
}

function localEntry(runtime: RuntimeEntry): ComparisonEntry {
  const model = runtime.model;
  return { key: JSON.stringify(['runtime', runtimeKey(model)]), name: model.name, provider: model.vendor, label: `${model.name} (${model.vendor}, ${model.version || 'version not reported'})`, runtime };
}

function comparisonEntries(): ComparisonEntry[] {
  const entries = [...state!.catalog.models.map(catalogEntry), ...runtimeEntries().map(localEntry)];
  return view.selected.flatMap(key => entries.filter(entry => entry.key === key));
}

function availability(entries: RuntimeEntry[]): HTMLElement {
  const detected = entries.some(entry => entry.detected);
  return badge(detected ? 'Detected in VS Code' : entries.length ? 'Remembered locally' : 'Listed by GitHub', detected ? 'positive' : '');
}

function toggleModel(modelId: string): void {
  const added = !view.selected.includes(modelId) && view.selected.length < 3;
  if (view.selected.includes(modelId)) view.selected = view.selected.filter(id => id !== modelId);
  else if (added) view.selected.push(modelId);
  persist();
  render();
  if (added) send({ type: 'compareScores', keys: [...view.selected] });
}

function compareButton(entry: ComparisonEntry): HTMLButtonElement {
  const selected = view.selected.includes(entry.key);
  const control = button(selected ? '✓ Added to compare' : '+ Add to compare', selected ? 'button selected' : 'button secondary', () => toggleModel(entry.key), `compare-${entry.key}`);
  control.setAttribute('aria-pressed', String(selected));
  control.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${entry.label} ${selected ? 'from' : 'to'} comparison`);
  control.disabled = !selected && view.selected.length >= 3;
  if (control.disabled) control.title = 'Remove a model to compare another. You can compare up to three.';
  return control;
}

function visibleScoreRecords(): ModelScore[] {
  return state!.scores.snapshot?.records.filter(record => state!.scores.includeComposites || !SCORE_METRICS[record.metric].composite) ?? [];
}

function scoreDetailsId(entry: ComparisonEntry): string {
  return entry.catalog ? `details-${entry.catalog.id}` : `score-details-${entry.key}`;
}

function showScoreChartsButton(entry: ComparisonEntry): HTMLButtonElement {
  const control = button(state!.scores.loading ? 'Loading scores…' : 'Show score charts', 'button primary score-charts-button', () => {
    view.tab = 'explore';
    const searchable = `${entry.name} ${entry.provider} ${entry.runtime?.model.id ?? ''} ${entry.runtime?.model.version ?? ''}`.toLowerCase();
    if (!searchable.includes(view.query.trim().toLowerCase())) view.query = '';
    if (view.filter === 'detected' && !(entry.runtime?.detected || entry.catalog && matches(entry.catalog).length)) view.filter = 'all';
    persist();
    render();
    const details = document.getElementById(scoreDetailsId(entry)) as HTMLDetailsElement | null;
    if (details) {
      details.open = true;
      const evidence = details.querySelector<HTMLElement>('.score-evidence');
      evidence?.scrollIntoView({ block: 'start' });
      evidence?.focus({ preventScroll: true });
    }
    send({ type: 'showScores', key: entry.key });
  });
  control.setAttribute('aria-label', `Show score charts for ${entry.label}`);
  control.disabled = state!.scores.loading;
  return control;
}

function switchTab(tab: ViewState['tab']): void {
  view.tab = tab;
  persist();
  render();
}

function header(): HTMLElement {
  const heading = element('div', 'heading',
    element('div', 'eyebrow', element('span', 'brand-mark'), 'MODELBEACON'),
    element('h1', '', 'A clearer choice.'),
    element('p', 'lede', 'Compare models for your task with sourced guidance and published score charts.'),
  );
  const detect = button(state!.discoveryStatus === 'loading' ? 'Detecting models…' : state!.discoveryStatus === 'ready' ? 'Detect models again' : 'Detect my models', 'button primary', () => {
    view.filter = 'detected';
    persist();
    send({ type: 'detectModels' });
  }, 'detect-models');
  detect.disabled = state!.discoveryStatus === 'loading';
  const picker = button('Open Copilot model picker ↗', 'button secondary', () => send({ type: 'openPicker' }), 'open-picker');
  return element('header', 'page-header', heading, element('div', 'header-actions', detect, picker));
}

function catalogStatus(): HTMLElement {
  const current = state!;
  const origin = { bundled: 'Bundled catalog', cached: 'Saved catalog', online: 'Online catalog' }[current.catalogOrigin];
  const refresh = button(current.catalogLoading ? 'Checking…' : 'Refresh catalog', 'text-button', () => send({ type: 'refreshCatalog' }), 'refresh-catalog');
  refresh.disabled = current.catalogLoading;
  const status = element('div', 'catalog-status',
    element('div', 'status-meta', element('span', 'status-dot'), element('span', '', origin), element('span', 'divider', '·'), element('span', '', `Reviewed ${date(current.catalog.reviewedAt)}`)), refresh,
  );
  const container = element('section', 'catalog-summary', status);
  container.setAttribute('aria-label', 'Catalog status');
  if (isStale(current.catalog.reviewedAt)) container.append(element('p', 'notice warning', 'This catalog has not been reviewed in more than 14 days. Check source pages for current availability and prices.'));
  if (current.catalogMessage) {
    const message = element('p', 'catalog-message', current.catalogMessage);
    message.setAttribute('role', 'status');
    container.append(message);
  }
  return container;
}

function discoveryStatus(): HTMLElement {
  const current = state!;
  const detectedCount = current.discovered.length;
  const summary: Record<ExplorerState['discoveryStatus'], string> = {
    idle: 'Browsing the public catalog and local models',
    loading: 'Checking models exposed by VS Code…',
    ready: `${detectedCount} ${detectedCount === 1 ? 'model' : 'models'} detected in VS Code`,
    empty: 'No models were returned by VS Code',
    error: 'Model detection is unavailable',
  };
  const description = current.discoveryStatus === 'ready'
    ? 'These models are exposed by VS Code. Detection does not verify subscription access or an identical model snapshot.'
    : current.discoveryStatus === 'idle'
      ? 'Detect models from all registered VS Code providers. Remembered models remain available to compare offline.'
      : current.discoveryStatus === 'loading'
        ? 'You can keep exploring the public catalog while this runs.'
        : 'You can still explore the public catalog and remembered models. Check your provider configuration, sign-in, and access.';
  const block = element('section', `discovery-status ${current.discoveryStatus === 'ready' ? 'detected' : ''}`,
    element('div', '', element('strong', '', summary[current.discoveryStatus]), element('p', '', description)),
  );
  block.setAttribute('role', 'status');
  if (current.discoveryMessage) block.append(element('p', 'subtle discovery-message', current.discoveryMessage));
  if (current.discoveryStatus === 'empty' || current.discoveryStatus === 'error') block.append(button('Copilot access help ↗', 'text-button', () => send({ type: 'openHelp', topic: 'signin' }), 'signin-help'));
  if (current.localModels.length || current.discovered.length || current.localModelsMessage || current.discoveryStatus === 'loading') {
    const clear = button('Clear local models', 'text-button', () => send({ type: 'clearLocalModels' }), 'clear-local-models');
    block.append(element('div', 'local-models-status', element('p', '', `${current.localModels.length} model identities remembered on this device. Remembered models may no longer be available.`), clear));
    if (current.localModelsMessage) block.append(element('p', 'subtle discovery-message', current.localModelsMessage));
  }
  return block;
}

function scoreStatus(): HTMLElement {
  const scores = state!.scores;
  const records = visibleScoreRecords();
  const references = new Set(records.map(record => record.modelId));
  const controls = element('div', 'score-actions');
  if (!scores.connected) {
    const connect = button('Connect OpenRouter', 'button secondary', () => send({ type: 'connectScores' }), 'connect-scores');
    connect.disabled = scores.loading;
    controls.append(connect);
  } else {
    const refresh = button(scores.loading ? 'Refreshing scores…' : 'Refresh scores', 'button secondary', () => send({ type: 'refreshScores' }), 'refresh-scores');
    refresh.disabled = scores.loading;
    controls.append(refresh);
  }
  if (scores.connected || scores.snapshot || Object.keys(scores.links).length) controls.append(button('Disconnect & clear scores', 'text-button', () => send({ type: 'clearScores' }), 'clear-scores'));
  const block = element('section', 'score-status',
    element('div', 'score-status-heading',
      element('div', '', element('h2', '', 'Published model scores'), element('p', 'subtle', 'Compare models to load published score charts automatically. You can change a reference when needed.')),
      controls,
    ),
  );
  block.setAttribute('aria-label', 'Published score connection');
  if (scores.snapshot) {
    block.append(element('p', 'score-cache-summary', `${number(records.length)} saved ${records.length === 1 ? 'score' : 'scores'} · ${number(references.size)} public ${references.size === 1 ? 'reference' : 'references'} available for the selected metrics.`));
    const hasReference = [...state!.catalog.models.map(catalogEntry), ...runtimeEntries().map(localEntry)]
      .some(entry => references.has(scoreReferenceId(entry) ?? ''));
    block.append(element('p', 'score-next-step', !records.length
      ? 'No saved scores match the current metric selection. Choose “Add to compare” or “Show score charts” to load the selected evaluations.'
      : !hasReference
        ? 'No unambiguous score references found for your models. Comparing automatically refreshes scores; you can optionally link a published reference.'
        : 'Choose “Add to compare”, “View comparison”, or “Show score charts” to automatically refresh scores. Matching published results appear without selecting a reference.'));
  }
  const include = element('input');
  include.type = 'checkbox';
  include.id = 'include-composite-scores';
  include.checked = scores.includeComposites;
  include.disabled = scores.loading;
  include.setAttribute('aria-describedby', 'composite-score-help');
  include.addEventListener('change', () => send({ type: 'setCompositeScores', enabled: include.checked }));
  const label = element('label', 'checkbox-label', include, 'Include composite indexes');
  label.htmlFor = include.id;
  const help = element('p', 'subtle', 'Optional Artificial Analysis intelligence, coding, and agentic indexes may incorporate Terminal-Bench. Off by default; GPQA Diamond and τ-bench are separate evaluations. Compare models, show score charts, or refresh scores after changing this option.');
  help.id = 'composite-score-help';
  block.append(element('div', 'score-policy', label, help));
  if (scores.snapshot) block.append(element('p', 'subtle score-freshness',
    `Source data as of ${date(scores.snapshot.asOf)} · Saved on this device ${date(scores.snapshot.fetchedAt)}.`,
    isStale(scores.snapshot.asOf.slice(0, 10)) ? ' Source data is over 14 days old.' : '',
    isStale(scores.snapshot.fetchedAt.slice(0, 10)) ? ' This saved snapshot is over 14 days old; refresh for current results.' : '',
  ));
  else block.append(element('p', 'subtle score-freshness', 'No score snapshot saved. Choose “Add to compare” or “Show score charts” to automatically load matching published results. VS Code asks for an OpenRouter API key when needed. No inference calls are made.'));
  if (scores.message) {
    const message = element('p', 'score-message subtle', scores.message);
    message.setAttribute('role', 'status');
    block.append(message);
  }
  return block;
}

function tabs(): HTMLElement {
  const list = element('div', 'tabs');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Explore models');
  for (const [tab, label] of [['choose', 'Choose for a task'], ['explore', 'Explore & compare']] as const) {
    const control = button(label, `tab ${view.tab === tab ? 'active' : ''}`, () => switchTab(tab), `${tab}-tab`);
    control.setAttribute('role', 'tab');
    control.setAttribute('aria-selected', String(view.tab === tab));
    control.setAttribute('aria-controls', `${tab}-panel`);
    control.tabIndex = view.tab === tab ? 0 : -1;
    control.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'choose' : event.key === 'End' ? 'explore' : tab === 'choose' ? 'explore' : 'choose';
      switchTab(next);
      document.getElementById(`${next}-tab`)?.focus();
    });
    list.append(control);
  }
  return list;
}

function taskChoices(): HTMLElement {
  const fieldset = element('fieldset', 'task-choices', element('legend', 'section-label', 'What are you working on?'));
  const choices = element('div', 'task-grid');
  for (const task of tasks) {
    const input = element('input');
    input.type = 'radio';
    input.name = 'task';
    input.id = `task-${task.id}`;
    input.value = task.id;
    input.checked = view.task === task.id;
    input.addEventListener('change', () => { view.task = task.id; persist(); render(); });
    const label = element('label', `task-card ${input.checked ? 'active' : ''}`, input,
      element('span', 'task-number', task.icon),
      element('span', 'task-copy', element('strong', '', task.name), element('span', '', task.description)),
    );
    label.htmlFor = input.id;
    choices.append(label);
  }
  fieldset.append(choices);
  return fieldset;
}

function guidanceCard(model: CatalogModel): HTMLElement {
  const guidance = model.guidance.find(item => item.task === view.task)!;
  const detected = matches(model).length > 0;
  return element('article', 'model-card recommendation',
    element('div', 'card-heading', element('span', 'provider', model.provider), badge(detected ? 'Detected' : 'Public catalog', detected ? 'positive' : '')),
    element('h3', 'model-title', model.name),
    element('p', 'guidance', guidance.rationale),
    element('div', 'limitation', element('span', 'mini-label', 'Consider before choosing'), element('p', '', guidance.limitation)),
    element('div', 'card-source', sourceLink(guidance.sourceId), element('span', 'subtle', `Reviewed ${date(state!.catalog.reviewedAt)}`)),
    showScoreChartsButton(catalogEntry(model)), compareButton(catalogEntry(model)),
  );
}

function choosePanel(): HTMLElement {
  const onlyAvailable = view.filter === 'detected';
  const suggested = recommendations(state!.catalog, view.task, state!.discovered, onlyAvailable);
  const currentTask = tasks.find(task => task.id === view.task)!;
  const filter = element('input');
  filter.id = 'available-models-only';
  filter.type = 'checkbox';
  filter.checked = onlyAvailable;
  filter.setAttribute('aria-describedby', 'availability-filter-help');
  filter.addEventListener('change', () => {
    view.filter = filter.checked ? 'detected' : 'all';
    persist();
    render();
    if (filter.checked && (state!.discoveryStatus === 'idle' || state!.discoveryStatus === 'error')) send({ type: 'detectModels' });
  });
  const filterLabel = element('label', 'checkbox-label', filter, element('strong', '', 'Available models only'));
  filterLabel.htmlFor = filter.id;
  const filterHelp = element('p', 'subtle', 'Show only models detected in this VS Code session. Remembered models alone do not qualify.');
  filterHelp.id = 'availability-filter-help';
  const section = element('section', 'tab-panel', element('div', 'home-filter', filterLabel, filterHelp), taskChoices(),
    element('div', 'section-heading', element('div', '', element('div', 'eyebrow', 'A STARTING POINT'), element('h2', '', `Options for ${currentTask.name.toLowerCase()}`)),
      badge(onlyAvailable ? 'From your detected models' : 'From the public catalog')),
    element('p', 'section-description', 'Curated interpretations of published guidance, listed alphabetically. These are starting points, not benchmark rankings.'),
  );
  section.id = 'choose-panel';
  section.setAttribute('role', 'tabpanel');
  section.setAttribute('aria-labelledby', 'choose-tab');
  if (suggested.length) section.append(element('div', 'recommendation-grid', ...suggested.map(guidanceCard)));
  else {
    const noAvailableModels = onlyAvailable && !state!.discovered.length;
    const explanation = noAvailableModels
      ? state!.discoveryStatus === 'loading' ? 'Detection is in progress. Public and remembered models stay hidden while this filter is on.' : 'No models are currently detected. Run detection again or browse the public catalog.'
      : onlyAvailable ? 'There is not enough reviewed task guidance for these models. You can still compare your available models below.' : 'There is not enough reviewed guidance for this task. Explore the catalog to see what is known.';
    section.append(element('div', 'empty-state', element('h3', '', noAvailableModels ? 'No available models detected' : 'No supported shortlist for this selection'), element('p', '', explanation), button('Explore the public catalog', 'button secondary', () => { view.filter = 'all'; switchTab('explore'); }, 'empty-explore')));
  }
  if (onlyAvailable) {
    const otherModels = state!.catalog.models.filter(model => matches(model).length && !suggested.some(candidate => candidate.id === model.id));
    const unknownModels = runtimeEntries().filter(entry => entry.detected && !matchModel(entry.model, state!.catalog));
    if (otherModels.length || unknownModels.length) section.append(element('section', 'other-available-models',
      element('h2', '', 'Other available models'),
      element('p', 'section-description', 'These models are currently detected but are outside this task’s reviewed shortlist. Compare the information available for each model.'),
      element('div', 'model-grid', ...otherModels.map(modelCard), ...unknownModels.map(unknownCard)),
    ));
  }
  section.append(element('aside', 'auto-card',
    element('div', 'auto-mark', 'A'),
    element('div', '', element('h3', '', 'Prefer to leave the choice to Copilot?'), element('p', '', 'Auto is worth considering when you want Copilot to route your task. Available choices can depend on your plan and organization.')),
    button('Understand Auto ↗', 'text-button', () => send({ type: 'openHelp', topic: 'auto' }), 'auto-help'),
  ));
  return section;
}

function priceContent(model: CatalogModel): HTMLElement {
  const pricing = activePricing(model);
  if (!pricing) return element('div', '', element('p', 'subtle', model.pricing ? 'Published price expired. Check GitHub for current rates.' : 'No reviewed pricing available.'), model.pricing ? sourceLink(model.pricing.sourceId, 'GitHub pricing') : undefined);
  const box = element('div', 'price-content');
  box.append(element('p', 'mini-label', 'Copilot token rates · USD / 1M tokens'));
  for (const tier of pricing.tiers) {
    const details = element('div', 'price-tier', element('strong', '', tier.name),
      element('p', '', `${money(tier.inputUsdPerMillion)} input · ${money(tier.outputUsdPerMillion)} output`));
    if (tier.cachedInputUsdPerMillion !== undefined) details.append(element('p', 'subtle', `${money(tier.cachedInputUsdPerMillion)} cached input`));
    if (tier.cacheWriteUsdPerMillion !== undefined) details.append(element('p', 'subtle', `${money(tier.cacheWriteUsdPerMillion)} cache write`));
    if (tier.threshold) details.append(element('p', 'subtle', tier.threshold));
    box.append(details);
  }
  box.append(sourceLink(pricing.sourceId, 'GitHub pricing'), element('p', 'subtle review-date', `Reviewed ${date(pricing.reviewedAt)}${pricing.validThrough ? ` · Valid through ${date(pricing.validThrough)}` : ''}`));
  return box;
}

function runtimeDetails(entry: RuntimeEntry): HTMLElement {
  const runtime = entry.model;
  return element('div', 'runtime-details',
    element('p', '', `${number(runtime.maxInputTokens)} tokens · ${entry.detected ? 'API-reported input limit' : 'Last reported input limit (cached)'}`),
    element('p', 'subtle', `Provider: ${runtime.vendor}`),
    element('p', 'subtle', `Runtime ID: ${runtime.id}`),
    element('p', 'subtle', `Family: ${runtime.family || 'Not reported'} · Version: ${runtime.version || 'Not reported'}`),
    element('p', 'subtle', entry.lastSeen ? `Last seen ${date(entry.lastSeen)}` : 'Detected this session; last-seen time not saved.'),
  );
}

function scoreReferenceId(entry: ComparisonEntry): string | undefined {
  const scores = state!.scores;
  return scores.links[entry.key] ?? findScoreReference(entry.runtime?.model ?? entry.catalog!, scores.snapshot?.records ?? []);
}

function linkedScore(entry: ComparisonEntry, metric: ScoreMetric): ModelScore | undefined {
  const scores = state!.scores;
  if (SCORE_METRICS[metric].composite && !scores.includeComposites) return undefined;
  const reference = scoreReferenceId(entry);
  return reference ? scores.snapshot?.records.find(record => record.modelId === reference && record.metric === metric) : undefined;
}

function scoreReference(entry: ComparisonEntry): HTMLElement {
  const scores = state!.scores;
  const manual = scores.links[entry.key];
  const reference = scoreReferenceId(entry);
  const record = scores.snapshot?.records.find(item => item.modelId === reference);
  const link = button(reference ? 'Change score reference' : 'Link score reference', 'text-button', () => send({ type: 'linkScores', key: entry.key }));
  link.setAttribute('aria-label', `${reference ? 'Change' : 'Link'} score reference for ${entry.label}`);
  link.disabled = scores.loading;
  if (link.disabled) link.title = 'Wait for the score refresh to finish.';
  const block = element('div', 'score-reference',
    element('p', 'subtle', reference ? `${manual ? 'Your' : 'Automatic'} reference: ${record?.modelName ?? reference}` : 'No unambiguous published reference found.'),
    reference ? element('p', 'score-reference-id subtle', reference) : undefined,
    link,
  );
  if (manual) {
    const unlink = button('Reset to automatic', 'text-button', () => send({ type: 'unlinkScores', key: entry.key }));
    unlink.setAttribute('aria-label', `Reset score reference to automatic for ${entry.label}`);
    unlink.disabled = scores.loading;
    block.append(unlink);
  }
  return block;
}

function scoreValue(record: ModelScore): string {
  return `${record.value.toFixed(1)}${SCORE_METRICS[record.metric].unit === '%' ? '%' : ' pts'}`;
}

function scoreChart(entries: ComparisonEntry[], metric: ScoreMetric, compact = false): HTMLElement {
  const metadata = SCORE_METRICS[metric];
  const largest = Math.max(100, ...entries.map(entry => linkedScore(entry, metric)?.value ?? 0));
  const roundedMaximum = Math.ceil(largest / 10) * 10;
  const maximum = metadata.unit === '%' ? 100 : Number.isFinite(roundedMaximum) ? roundedMaximum : largest;
  const figure = element('figure', `score-chart${compact ? ' compact-score-chart' : ''}`,
    element('figcaption', '', element('strong', '', metadata.label), element('span', 'subtle', metadata.unit === '%' ? 'Accuracy (%) · Higher is better' : 'Index points · Higher is better')),
  );
  figure.dataset.metric = metric;
  const draw = (svg: SVGSVGElement, tag: string, attrs: Record<string, string | number>): void => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  };
  for (const [index, entry] of entries.entries()) {
    const record = linkedScore(entry, metric);
    const row = element('div', `score-chart-row score-series-${index}`,
      element('div', 'score-row-label', element('span', 'score-model-label', element('span', 'score-swatch'), entry.label), element('strong', 'score-number', record ? scoreValue(record) : 'Unavailable')),
    );
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 308 28');
    svg.setAttribute('aria-hidden', 'true');
    for (const tick of [0, 25, 50, 75, 100]) draw(svg, 'line', { x1: 4 + tick * 3, x2: 4 + tick * 3, y1: 0, y2: 28, class: 'score-grid' });
    if (record) {
      draw(svg, 'rect', { x: 4, y: 5, width: record.value / maximum * 300, height: 18, rx: 3, class: 'score-bar' });
      // A zero result still has a visible mark; absent results never draw a bar.
      if (record.value === 0) draw(svg, 'line', { x1: 4, x2: 4, y1: 5, y2: 23, class: 'score-zero' });
      if (record.standardDeviation !== undefined) {
        const low = 4 + Math.max(0, record.value - record.standardDeviation) / maximum * 300;
        const high = 4 + Math.min(maximum, record.value + record.standardDeviation) / maximum * 300;
        draw(svg, 'line', { x1: low, x2: high, y1: 14, y2: 14, class: 'score-deviation' });
        for (const x of [low, high]) draw(svg, 'line', { x1: x, x2: x, y1: 9, y2: 19, class: 'score-deviation' });
      }
    } else svg.classList.add('score-missing');
    row.append(svg);
    const details: string[] = [];
    if (record) {
      if (record.standardDeviation !== undefined) details.push(`SD ±${record.standardDeviation.toFixed(1)} ${metadata.unit === '%' ? 'percentage points' : 'points'}`);
      if (record.sampleSize !== undefined) details.push(`n = ${number(record.sampleSize)}`);
      if (record.evaluatedAt) details.push(`Evaluated ${date(record.evaluatedAt)}`);
      if (!details.length) details.push('Evaluation date, sample size, and uncertainty not reported.');
      if (record.asOf) details.push(`Source as of ${date(record.asOf)}`);
      if (isStale((record.asOf ?? state!.scores.snapshot!.asOf).slice(0, 10))) details.push('Source data over 14 days old');
    } else details.push(scoreReferenceId(entry) ? 'No published result for this reference.' : 'No unambiguous reference match. You can optionally link a published reference.');
    row.append(element('p', 'subtle score-row-details', details.join(' · ')));
    if (record?.citation) row.append(element('p', 'subtle score-row-details', `Source citation: ${record.citation}`));
    figure.append(row);
  }
  const axisFormat = new Intl.NumberFormat(undefined, { notation: maximum >= 1_000_000 ? 'scientific' : maximum >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 });
  figure.append(element('div', 'score-axis', ...[0, .25, .5, .75, 1].map(fraction => element('span', '', axisFormat.format(maximum * fraction)))));
  const source = button(`${metadata.source} ↗`, 'text-button score-source', () => send({ type: 'openScoreSource', metric }));
  source.setAttribute('aria-label', `${metadata.label}: ${metadata.source} methodology (opens in browser)`);
  figure.append(source);
  if (entries.some(entry => linkedScore(entry, metric)?.standardDeviation !== undefined)) figure.append(element('p', 'subtle score-uncertainty', 'Whiskers show source-reported standard deviation (SD), not a confidence interval. Whiskers are clipped at the plotted axis limits.'));
  return figure;
}

function scoreEvidence(entries: ComparisonEntry[], compact = false): HTMLElement {
  const scores = state!.scores;
  const section = element('section', `score-evidence${compact ? ' compact-score-evidence' : ''}`,
    element('div', 'section-heading', element(compact ? 'h4' : 'h3', '', 'Published scores'), compact ? undefined : badge('External evaluations')),
  );
  if (compact) {
    section.id = `score-evidence-${entries[0].key}`;
    section.tabIndex = -1;
    section.setAttribute('aria-label', `Published scores for ${entries[0].label}`);
    section.append(scoreReference(entries[0]));
  }
  else section.append(element('div', 'score-reference-grid', ...entries.map(entry => element('div', 'score-reference-card', element('strong', '', entry.label), scoreReference(entry)))));
  if (scores.loading) {
    const progress = element('p', 'subtle score-loading', 'Loading published scores… Saved charts remain available while this runs.');
    progress.setAttribute('role', 'status');
    section.append(progress);
  } else if (scores.message) {
    const feedback = element('p', 'subtle score-feedback', scores.message);
    feedback.setAttribute('role', 'status');
    section.append(feedback);
  }
  const hasReference = entries.some(entry => scoreReferenceId(entry));
  if (hasReference && scores.snapshot) {
    const metrics = (Object.keys(SCORE_METRICS) as ScoreMetric[]).filter(metric => scores.includeComposites || !SCORE_METRICS[metric].composite);
    section.append(element('div', 'score-chart-grid', ...metrics.map(metric => scoreChart(entries, metric, compact))));
    section.append(element('p', 'subtle score-freshness', `Source data as of ${date(scores.snapshot.asOf)} · Saved ${date(scores.snapshot.fetchedAt)}${isStale(scores.snapshot.fetchedAt.slice(0, 10)) ? ' · Snapshot over 14 days old' : ''}.`));
  } else if (!scores.loading) section.append(element('p', 'subtle score-empty', compact
    ? 'Choose “Show score charts” to automatically load matching published results. Missing or ambiguous matches remain unavailable; you can optionally link a reference.'
    : 'Adding a model or choosing “View comparison” automatically loads scores and displays matching published results. Missing or ambiguous matches remain unavailable; you can optionally link a reference.'));
  section.append(element('p', 'subtle score-caveat', 'References are matched automatically by published identifiers or names, or selected by you. They are not verified model matches. Provider, version, reasoning settings, and evaluation setup can differ from your Copilot session. These charts are not measurements of your deployment. Evaluation settings may also differ between references; bar differences do not establish statistical significance.'));
  return section;
}

function modelCard(model: CatalogModel): HTMLElement {
  const runtimes = catalogRuntimes(model);
  const observations = state!.catalog.benchmarks.filter(item => item.modelId === model.id);
  const details = element('details', 'model-details', element('summary', '', 'Capabilities, rates, scores & detection'));
  details.id = scoreDetailsId(catalogEntry(model));
  if (model.facts.length) details.append(element('ul', 'facts', ...model.facts.map(fact => element('li', '', element('span', '', fact.text), sourceLink(fact.sourceId)))));
  details.append(priceContent(model));
  for (const runtime of runtimes) details.append(runtimeDetails(runtime));
  if (runtimes.length) details.append(element('p', 'subtle', 'A reviewed runtime alias matches this catalog entry. An identical deployed model snapshot is not established.'));
  details.append(scoreEvidence([catalogEntry(model)], true));
  return element('article', 'model-card browse-card',
    element('div', 'card-heading', element('span', 'provider', model.provider), availability(runtimes)),
    element('h3', 'model-title', model.name),
    state!.catalog.benchmarks.length ? element('p', 'evidence-count', observations.length ? `${observations.length} external benchmark ${observations.length === 1 ? 'observation' : 'observations'}` : 'No matching benchmark evidence') : undefined,
    details, showScoreChartsButton(catalogEntry(model)), compareButton(catalogEntry(model)),
  );
}

function unknownCard(entry: RuntimeEntry): HTMLElement {
  const runtime = entry.model;
  const details = element('details', 'model-details', element('summary', '', 'Published scores'), scoreEvidence([localEntry(entry)], true));
  details.id = scoreDetailsId(localEntry(entry));
  return element('article', 'model-card unknown-card',
    element('div', 'card-heading', element('span', 'provider', runtime.vendor), availability([entry])),
    element('h3', 'model-title', runtime.name),
    state!.catalog.benchmarks.length ? element('p', 'evidence-count', 'No matching benchmark evidence') : undefined,
    element('p', 'subtle', 'No reviewed catalog alias matches this runtime identity. Published capabilities and pricing are unknown.'),
    runtimeDetails(entry), details, showScoreChartsButton(localEntry(entry)), compareButton(localEntry(entry)),
  );
}

function explorePanel(): HTMLElement {
  const search = element('input', 'search-input');
  search.type = 'search';
  search.id = 'model-search';
  search.placeholder = 'Search models or providers…';
  search.value = view.query;
  search.addEventListener('input', () => { view.query = search.value; persist(); render(); });
  const searchLabel = element('label', 'search-label', element('span', 'sr-only', 'Search models or providers'), search);
  searchLabel.htmlFor = search.id;
  const filters = element('div', 'filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Model availability');
  for (const [filter, label] of [['all', 'Public catalog + local'], ['detected', 'Detected in VS Code']] as const) {
    const control = button(label, `filter ${view.filter === filter ? 'active' : ''}`, () => { view.filter = filter; persist(); render(); }, `filter-${filter}`);
    control.setAttribute('aria-pressed', String(view.filter === filter));
    filters.append(control);
  }
  const query = view.query.trim().toLowerCase();
  const models = state!.catalog.models.filter(model =>
    (view.filter === 'all' || matches(model).length > 0) && `${model.name} ${model.provider}`.toLowerCase().includes(query),
  );
  const unknown = runtimeEntries().filter(({ model, detected }) => (view.filter === 'all' || detected)
    && !matchModel(model, state!.catalog) && `${model.name} ${model.vendor} ${model.id} ${model.version}`.toLowerCase().includes(query));
  const count = models.length + unknown.length;
  const section = element('section', 'tab-panel');
  section.id = 'explore-panel';
  section.setAttribute('role', 'tabpanel');
  section.setAttribute('aria-labelledby', 'explore-tab');
  if (view.selected.length) section.append(comparison());
  section.append(element('div', 'section-heading', element('div', '', element('div', 'eyebrow', 'EXPLORE THE CATALOG'), element('h2', '', 'A little context goes a long way.'))),
    element('p', 'section-description', 'Compare up to three catalog or local models. Explore published capabilities, task guidance, and rates alongside provider-reported metadata.'),
    element('div', 'browse-controls', searchLabel, filters));
  const results = element('p', 'results-count', `${count} ${count === 1 ? 'model' : 'models'}${query ? ' matching your search' : ''}`);
  results.setAttribute('role', 'status');
  section.append(results);
  if (count) section.append(element('div', 'model-grid', ...models.map(modelCard), ...unknown.map(unknownCard)));
  else section.append(element('div', 'empty-state', element('h3', '', query ? 'No matching models' : 'No detected models to show'), element('p', '', query ? 'Try another model name or provider.' : 'Detect VS Code models, or switch to the public catalog and local history.')));
  return section;
}

function comparison(): HTMLElement {
  const entries = comparisonEntries();
  const runtimes = (entry: ComparisonEntry): RuntimeEntry[] => entry.runtime ? [entry.runtime] : catalogRuntimes(entry.catalog!);
  const block = element('section', 'comparison-section',
    element('div', 'section-heading', element('div', '', element('div', 'eyebrow', 'SIDE BY SIDE'), element('h2', '', 'Compare your options')), button('Clear comparison', 'text-button', () => { view.selected = []; persist(); render(); }, 'clear-comparison')),
    element('p', 'section-description', 'Compare published capabilities, task guidance, and pricing for catalog models. Local entries show provider-reported metadata; a shared name or ID does not establish the same deployed model.'),
  );
  const table = element('table', 'comparison-table');
  table.append(element('caption', 'sr-only', 'Selected models: capabilities, API input limits, and published pricing'));
  const headRow = element('tr', '', element('th', '', 'Model'));
  for (const entry of entries) {
    const cell = element('th', '', element('span', 'provider', entry.provider), element('strong', 'compare-name', entry.name), button('Remove', 'text-button remove-button', () => toggleModel(entry.key), `remove-${entry.key}`));
    cell.scope = 'col';
    cell.querySelector('button')!.setAttribute('aria-label', `Remove ${entry.label} from comparison`);
    headRow.append(cell);
  }
  (headRow.firstElementChild as HTMLTableCellElement).scope = 'col';
  table.append(element('thead', '', headRow));
  const body = element('tbody');
  const row = (label: string, content: (entry: ComparisonEntry) => Node): void => {
    const heading = element('th', '', label);
    heading.scope = 'row';
    body.append(element('tr', '', heading, ...entries.map(entry => element('td', '', content(entry)))));
  };
  row('Availability', entry => availability(runtimes(entry)));
  row('Runtime identity', entry => runtimes(entry).length
    ? element('div', 'identity-details', ...runtimes(entry).map(({ model }) => element('div', '', element('p', '', `Provider: ${model.vendor}`), element('p', '', `ID: ${model.id}`), element('p', 'subtle', `Version: ${model.version || 'Not reported'}`))))
    : element('span', 'subtle', 'Not reported by VS Code.'));
  row('Last seen', entry => runtimes(entry).length
    ? element('div', '', ...runtimes(entry).map(runtime => element('p', '', runtime.lastSeen ? date(runtime.lastSeen) : 'Detected this session; time not saved.')))
    : element('span', 'subtle', 'No local detection history.'));
  row(`${tasks.find(task => task.id === view.task)!.name} guidance`, entry => {
    const guidance = entry.catalog?.guidance.find(item => item.task === view.task);
    return guidance
      ? element('div', '', element('p', '', guidance.rationale), element('p', 'subtle', guidance.limitation), sourceLink(guidance.sourceId), element('p', 'subtle review-date', `Reviewed ${date(state!.catalog.reviewedAt)}`))
      : element('span', 'subtle', 'No reviewed guidance for this task.');
  });
  row('Published capabilities', entry => entry.catalog?.facts.length
    ? element('ul', 'facts', ...entry.catalog.facts.map(fact => element('li', '', element('span', '', fact.text), sourceLink(fact.sourceId))))
    : element('span', 'subtle', 'Unknown; no reviewed capability information.'));
  row('API input limit', entry => runtimes(entry).length
    ? element('div', '', ...runtimes(entry).map(({ model, detected }) => element('p', '', `${number(model.maxInputTokens)} tokens (${model.name}) · ${detected ? 'API-reported' : 'Last reported (cached)'}`)), element('p', 'subtle', 'Reported by VS Code; not the advertised context window.'))
    : element('span', 'subtle', 'Not detected; API input limit unknown'));
  row('Published token pricing', entry => entry.catalog ? priceContent(entry.catalog) : element('span', 'subtle', 'Unknown; no published price linked to this runtime.'));
  table.append(body);
  const scroll = element('div', 'table-scroll', table);
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Model comparison table, scroll horizontally if needed');
  block.append(scoreEvidence(entries), scroll, element('p', 'pricing-note', 'Token rates are published in USD per million tokens for AI-credit billing. Your plan, token usage, and any applicable tier determine cost. ', button('Legacy billing information ↗', 'text-button', () => send({ type: 'openHelp', topic: 'legacy' }), 'legacy-help')));
  if (state!.catalog.benchmarks.length) block.append(benchmarkEvidence(entries));
  return block;
}

function benchmarkEvidence(entries: ComparisonEntry[]): HTMLElement {
  const models = entries.flatMap(entry => entry.catalog ? [entry.catalog] : []);
  const observations = state!.catalog.benchmarks.filter(item => models.some(model => model.id === item.modelId));
  const section = element('section', 'benchmark-section',
    element('div', 'section-heading', element('h3', '', 'Published benchmark evidence'), badge('External evaluations')),
    element('p', 'section-description', 'These results evaluate an agent and a model in a specific setup. They do not measure your Copilot session or predict every task. Missing evidence is unknown, never zero.'),
  );
  for (const entry of entries.filter(entry => entry.runtime)) section.append(element('p', 'subtle', `${entry.label}: benchmark evidence unknown. No automatic match by name or ID.`));
  if (!observations.length) {
    section.append(element('div', 'empty-state compact', element('p', '', 'No matching benchmark evidence for these models.')));
    return section;
  }
  const groups = new Map<string, BenchmarkObservation[]>();
  for (const observation of observations) {
    const key = observation.comparisonGroup ?? `observation:${observation.id}`;
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  const charted = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2 || !areComparable(group)) continue;
    group.forEach(observation => charted.add(observation.id));
    section.append(benchmarkChart(group));
  }
  if (observations.some(item => !charted.has(item.id))) section.append(element('p', 'notice', 'Some results have different or unverified evaluation configurations. They are shown as individual observations, without a shared ranking.'));
  section.append(benchmarkTable(observations));
  for (const model of models.filter(model => !observations.some(item => item.modelId === model.id))) section.append(element('p', 'subtle', `${model.name}: no matching benchmark evidence.`));
  return section;
}

function benchmarkChart(observations: BenchmarkObservation[]): HTMLElement {
  const first = observations[0];
  const figure = element('figure', 'benchmark-chart', element('figcaption', '', element('strong', '', `${first.benchmark} ${first.benchmarkVersion}`), element('span', 'subtle', `${first.agent} ${first.agentVersion} · Reasoning: ${first.reasoningEffort}`)));
  figure.append(element('p', 'subtle', 'Verified compatible evaluation group · Accuracy (%) · Higher is better'));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const width = 700;
  const height = observations.length * 52 + 28;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  const draw = (tag: string, attrs: Record<string, string | number>, content?: string): void => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (content) node.textContent = content;
    svg.append(node);
  };
  const plotX = 180;
  const plotWidth = 420;
  for (const tick of [0, 25, 50, 75, 100]) {
    const x = plotX + plotWidth * tick / 100;
    draw('line', { x1: x, x2: x, y1: 0, y2: height - 24, class: 'chart-grid' });
    draw('text', { x, y: height - 3, 'text-anchor': 'middle', class: 'chart-tick' }, String(tick));
  }
  observations.forEach((observation, index) => {
    const y = index * 52 + 10;
    const name = state!.catalog.models.find(model => model.id === observation.modelId)!.name;
    draw('text', { x: plotX - 12, y: y + 18, 'text-anchor': 'end', class: 'chart-label' }, name);
    draw('rect', { x: plotX, y, width: plotWidth * observation.accuracy / 100, height: 26, rx: 4, class: 'chart-bar' });
    if (observation.ci95 !== undefined) {
      const low = plotX + plotWidth * Math.max(0, observation.accuracy - observation.ci95) / 100;
      const high = plotX + plotWidth * Math.min(100, observation.accuracy + observation.ci95) / 100;
      draw('line', { x1: low, x2: high, y1: y + 13, y2: y + 13, class: 'chart-ci' });
      for (const x of [low, high]) draw('line', { x1: x, x2: x, y1: y + 8, y2: y + 18, class: 'chart-ci' });
    }
    draw('text', { x: plotX + plotWidth + 14, y: y + 18, class: 'chart-value' }, `${observation.accuracy.toFixed(1)}%`);
  });
  figure.append(svg, element('p', 'subtle', 'Whiskers show source-provided 95% confidence intervals where available. The table below contains the same results and full evaluation details.'));
  return figure;
}

function benchmarkTable(observations: BenchmarkObservation[]): HTMLElement {
  const table = element('table', 'benchmark-table');
  table.append(element('caption', 'sr-only', 'Benchmark observations and evaluation configurations'));
  const headings = ['Model & evaluation', 'Accuracy', 'Configuration', 'Dates & source'];
  table.append(element('thead', '', element('tr', '', ...headings.map(label => { const cell = element('th', '', label); cell.scope = 'col'; return cell; }))));
  const body = element('tbody');
  for (const observation of observations) {
    const model = state!.catalog.models.find(candidate => candidate.id === observation.modelId)!;
    const heading = element('th', '', element('strong', '', model.name), element('span', 'subtle block', `${observation.benchmark} ${observation.benchmarkVersion}`));
    heading.scope = 'row';
    const score = element('td', '', element('strong', 'score', `${observation.accuracy.toFixed(1)}%`), element('span', 'subtle block', observation.ci95 === undefined ? '95% CI not reported' : `± ${observation.ci95.toFixed(1)} percentage points (95% CI)`));
    const configuration = element('td', '', element('p', '', `${observation.agent} ${observation.agentVersion}`), element('p', 'subtle', `Reasoning: ${observation.reasoningEffort}`), element('p', 'subtle', `${number(observation.trials)} trials`));
    const dates = element('td', '', element('p', '', observation.evaluatedAt ? `Evaluated ${date(observation.evaluatedAt)}` : 'Evaluation date not reported'));
    if (observation.submittedAt) dates.append(element('p', 'subtle', `Submitted ${date(observation.submittedAt)}`));
    if (observation.modelReleasedAt) dates.append(element('p', 'subtle', `Model released ${date(observation.modelReleasedAt)}`));
    dates.append(sourceLink(observation.sourceId));
    const source = state!.catalog.sources.find(item => item.id === observation.sourceId);
    if (source?.revision) dates.append(element('p', 'subtle revision', `Source revision: ${source.revision}`));
    body.append(element('tr', '', heading, score, configuration, dates));
  }
  table.append(body);
  const scroll = element('div', 'table-scroll', table);
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Benchmark results table, scroll horizontally if needed');
  return scroll;
}

function compareTray(): HTMLElement | undefined {
  if (!view.selected.length) return undefined;
  const tray = element('aside', 'compare-tray');
  tray.setAttribute('aria-label', 'Comparison selection');
  const items = element('div', 'compare-selection', element('strong', '', `Compare ${view.selected.length}/3`));
  for (const entry of comparisonEntries()) {
    const remove = button('×', 'chip-remove', () => toggleModel(entry.key), `tray-remove-${entry.key}`);
    remove.setAttribute('aria-label', `Remove ${entry.label} from comparison`);
    items.append(element('span', 'selection-chip', entry.label, remove));
  }
  const show = button('View comparison →', 'button primary', () => {
    switchTab('explore');
    document.querySelector('.comparison-section')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    document.getElementById('clear-comparison')?.focus({ preventScroll: true });
    send({ type: 'compareScores', keys: [...view.selected] });
  }, 'view-comparison');
  tray.append(items, show);
  return tray;
}

function footer(): HTMLElement {
  const settings = element('details', 'evidence-details', element('summary', '', 'About the evidence & catalog updates'));
  settings.id = 'evidence-details';
  settings.append(element('p', '', 'Guidance is editorial interpretation of cited sources. Published capabilities and rates describe catalog entries; a shared model name does not establish an identical deployed snapshot.'),
    element('p', '', 'Published scores are external evaluations downloaded from OpenRouter when you compare models, show score charts, connect, or refresh. References match automatically by published identifiers or names; you can optionally choose a different reference. Neither verifies your deployed model. Scores keep their source, dates, and units, and missing results remain unavailable.'),
    element('p', '', 'The OpenRouter key is stored securely by VS Code. Saved scores and reference links stay on this device. Disconnect & clear scores removes the key, score cache, and reference links.'),
    element('p', '', 'Detected model identity, name, provider, version, family, input limit, and last-seen time are remembered on this device. Custom model metadata is not uploaded or merged into the public catalog. Clear local models removes this history, runtime comparison selections, and runtime score references.'),
  );
  if (state!.catalog.benchmarks.length) settings.append(element('p', '', 'Benchmark observations retain their evaluation configuration and dates. Charts appear only for reviewed compatible evaluation groups; their results do not establish performance on every coding task.'));
  const automatic = element('input');
  automatic.type = 'checkbox';
  automatic.id = 'auto-update';
  automatic.checked = state!.autoUpdateCatalog;
  automatic.addEventListener('change', () => send({ type: 'setAutoUpdate', enabled: automatic.checked }));
  const updateLabel = element('label', 'checkbox-label', automatic, 'Automatically check for catalog updates when this explorer opens (at most once daily)');
  updateLabel.htmlFor = automatic.id;
  settings.append(updateLabel, element('p', 'subtle', 'Catalog updates contact public hosting. If an update fails, the last valid catalog stays available.'), element('p', 'subtle', `Catalog revision: ${state!.catalog.revision}`));
  const sources = element('ul', 'source-list');
  for (const source of state!.catalog.sources) sources.append(element('li', '', sourceLink(source.id, source.title), element('span', 'subtle', ` · ${source.license} · Retrieved ${date(source.retrievedAt)}`)));
  settings.append(sources);
  return element('footer', 'page-footer', settings, element('p', 'privacy-note', 'No inference calls. No telemetry. Your code, prompts, and chat history stay out of this explorer.'));
}

function render(): void {
  if (!state) {
    root.replaceChildren(element('div', 'loading-state', element('div', 'eyebrow', 'MODELBEACON'), element('h1', '', 'Loading your catalog…')));
    return;
  }
  const active = document.activeElement as HTMLInputElement | null;
  const focusId = active?.id;
  const selectionStart = active?.id === 'model-search' ? active.selectionStart : null;
  const selectionEnd = active?.id === 'model-search' ? active.selectionEnd : null;
  const openDetails = [...document.querySelectorAll<HTMLDetailsElement>('details[open]')].map(details => details.id);
  // Preserve catalog selections saved before runtime comparisons used namespaced keys.
  view.selected = view.selected.map(key => state!.catalog.models.some(model => model.id === key) ? JSON.stringify(['catalog', key]) : key);
  view.selected = comparisonEntries().map(entry => entry.key);
  persist();
  sourceCounter = 0;
  root.replaceChildren(element('div', 'shell', header(), catalogStatus(), discoveryStatus(), scoreStatus(), tabs(), view.tab === 'choose' ? choosePanel() : explorePanel(), footer(), compareTray()));
  for (const details of document.querySelectorAll<HTMLDetailsElement>('details')) if (openDetails.includes(details.id)) details.open = true;
  if (focusId) {
    const next = document.getElementById(focusId) as HTMLInputElement | null;
    next?.focus({ preventScroll: true });
    if (focusId === 'model-search' && selectionStart !== null && selectionEnd !== null) next?.setSelectionRange(selectionStart, selectionEnd);
  }
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  if (event.data?.type !== 'state') return;
  state = event.data.state;
  render();
});
render();
send({ type: 'ready' });
