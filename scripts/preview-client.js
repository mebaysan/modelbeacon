// Development-only bridge; never included in the VSIX.
window.__messages = [];
window.__explorerState = undefined;
window.__setExplorerState = state => {
  window.__explorerState = state;
  sessionStorage.setItem('explorer-local-models', JSON.stringify(state.localModels));
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } }));
};
const loaded = fetch('/catalog.json').then(response => response.json()).then(catalog => ({
  catalog,
  catalogOrigin: 'bundled',
  catalogMessage: 'Development preview. Detection uses fixtures, not your Copilot account.',
  catalogLoading: false,
  extraCatalogs: [],
  extraCatalogsMessage: '',
  discovered: [],
  localModels: JSON.parse(sessionStorage.getItem('explorer-local-models') || '[]'),
  localModelsMessage: '',
  discoveryStatus: 'idle',
  discoveryMessage: 'Explore the public catalog or detect sample models in this preview.',
  autoUpdateCatalog: false,
  scores: { connected: false, loading: false, message: 'Compare models or use “Show score charts” in VS Code to load published scores securely.', includeComposites: false, links: {} },
}));
window.acquireVsCodeApi = () => ({
  getState: () => JSON.parse(sessionStorage.getItem('explorer') || 'null'),
  setState: state => sessionStorage.setItem('explorer', JSON.stringify(state)),
  postMessage: async message => {
    window.__messages.push(message);
    const state = window.__explorerState || await loaded;
    if (message.type === 'detectModels') {
      state.discovered = state.catalog.models.slice(0, 6).map(model => ({
        id: model.aliases[0]?.id || model.id,
        name: model.name,
        vendor: 'copilot',
        family: model.id,
        version: model.aliases[0]?.version || 'preview',
        maxInputTokens: 128_000,
      }));
      state.discovered.push({ id: 'preview-coder', name: 'My local coder', vendor: 'preview-local', family: 'coder', version: '1', maxInputTokens: 32_000 });
      const key = model => JSON.stringify([model.vendor, model.id, model.version]);
      const remembered = new Map(state.localModels.map(model => [key(model), model]));
      for (const model of state.discovered) remembered.set(key(model), { ...model, lastSeen: new Date().toISOString() });
      state.localModels = [...remembered.values()];
      state.localModelsMessage = 'Preview metadata remembered in this browser tab only.';
      state.discoveryStatus = 'ready';
      state.discoveryMessage = 'Preview fixture models only. These are not account entitlements.';
    }
    if (message.type === 'clearLocalModels') {
      state.localModels = [];
      state.discovered = [];
      state.discoveryStatus = 'idle';
      state.discoveryMessage = '';
      state.localModelsMessage = 'Local model history cleared.';
    }
    if (message.type === 'setAutoUpdate') state.autoUpdateCatalog = message.enabled;
    if (message.type === 'addCatalogUrl' || message.type === 'importCatalogFile') {
      const kind = message.type === 'addCatalogUrl' ? 'url' : 'file';
      const id = kind === 'url' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222';
      if (!state.extraCatalogs.some(catalog => catalog.id === id)) {
        const label = kind === 'url' ? 'Example team catalog' : 'Example imported catalog';
        const reviewedAt = '2026-10-01';
        state.extraCatalogs.push({ id, label, kind, modelCount: 2, addedModelCount: 1, ignoredModelCount: 1, revision: '2026-10-18.1', reviewedAt, syncedAt: '2026-10-18', message: 'Preview fixture: one conflicting model was skipped.' });
        state.catalog.models.push({ ...state.catalog.models.find(model => model.guidance.some(guidance => guidance.task === 'everyday')), id: `example-extra-${kind}`, name: kind === 'url' ? 'Example Team Coder' : 'Example File Coder', provider: 'Example provider', aliases: [], catalogLabel: label, catalogReviewedAt: reviewedAt });
      }
      state.extraCatalogsMessage = 'Preview fixtures only. VS Code opens the URL input or JSON file picker and saves your added catalog locally.';
    }
    if (message.type === 'removeExtraCatalog') {
      const catalog = state.extraCatalogs.find(catalog => catalog.id === message.id);
      if (catalog) {
        state.catalog.models = state.catalog.models.filter(model => model.catalogLabel !== catalog.label);
        state.extraCatalogs = state.extraCatalogs.filter(catalog => catalog.id !== message.id);
        state.extraCatalogsMessage = 'Preview catalog removed. The built-in catalog is unchanged.';
      }
    }
    if (message.type === 'refreshExtraCatalogs') state.extraCatalogsMessage = 'Preview only. VS Code refreshes your saved catalog sources and retains the last valid data if a refresh fails.';
    if (message.type === 'setCompositeScores') state.scores.includeComposites = message.enabled;
    if (message.type === 'connectScores' || message.type === 'refreshScores' || message.type === 'linkScores' || message.type === 'showScores' || message.type === 'compareScores') {
      state.scores.message = 'Preview only: use the VS Code extension to load matching published scores automatically. API keys are entered only in VS Code.';
    }
    if (message.type === 'unlinkScores') delete state.scores.links[message.key];
    if (message.type === 'clearScores') {
      state.scores = { connected: false, loading: false, includeComposites: state.scores.includeComposites, links: {}, message: 'Preview scores and reference links cleared.' };
    }
    if (['ready', 'detectModels', 'clearLocalModels', 'setAutoUpdate', 'refreshCatalog', 'addCatalogUrl', 'importCatalogFile', 'removeExtraCatalog', 'refreshExtraCatalogs', 'connectScores', 'refreshScores', 'clearScores', 'linkScores', 'showScores', 'compareScores', 'unlinkScores', 'setCompositeScores'].includes(message.type)) {
      window.__setExplorerState(state);
    }
  },
});
