import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { CatalogStore } from './catalog-store.ts';
import { LocalModelStore, parseDiscoveredModels } from './local-model-store.ts';
import { ScoreStore } from './score-store.ts';
import { SCORE_METRICS } from './scores.ts';
import { isSafeExternalUrl, isWebviewRequest, runtimeKey } from './core.ts';
import type { ExplorerState, HostMessage } from './types.ts';

declare const __CATALOG_URL__: string;

const HELP = {
  auto: 'https://docs.github.com/en/copilot/concepts/models/auto-model-selection',
  legacy: 'https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans',
  signin: 'https://code.visualstudio.com/docs/copilot/setup',
};
const SCORE_SECRET = 'openRouterApiKey';
const SCORE_LINKS = 'scoreLinks.v1';

function readScoreLinks(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 2000).filter(([key, id]) =>
    key.length <= 1800 && /^\["(?:catalog|runtime)","/.test(key)
    && typeof id === 'string' && id.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:+-]*$/.test(id)));
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const bundled = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'data', 'catalog.json'));
  const store = new CatalogStore(JSON.parse(Buffer.from(bundled).toString('utf8')), context.globalState, __CATALOG_URL__);
  const localModels = new LocalModelStore(context.globalState);
  const scores = new ScoreStore(context.globalState);
  let scoreConnected = false;
  try { scoreConnected = !!await context.secrets.get(SCORE_SECRET); } catch { /* Connection can be retried through the native input. */ }
  let savedScoreLinks: Record<string, string> = {};
  try { savedScoreLinks = readScoreLinks(context.globalState.get(SCORE_LINKS)); } catch { /* An unreadable local cache does not prevent browsing. */ }
  let panel: vscode.WebviewPanel | undefined;
  let sidebar: vscode.WebviewView | undefined;
  let sidebarConnection: vscode.Disposable | undefined;
  const readyWebviews = new Set<vscode.Webview>();
  let hasDetected = false;
  let modelsDirty = false;
  let detecting: Promise<void> | undefined;
  let discoveryGeneration = 0;
  let disposed = false;
  let scoreGeneration = 0;
  let clearingScores = false;
  let scoreWrites: Promise<void> = Promise.resolve();
  let connectingScores: Promise<boolean> | undefined;
  let refreshingScores: Promise<void> | undefined;
  const scoreActions = new Map<string, Promise<void>>();
  const state: ExplorerState = {
    catalog: store.catalog,
    catalogOrigin: store.origin,
    catalogMessage: store.message,
    catalogLoading: false,
    discovered: [],
    localModels: localModels.models,
    localModelsMessage: localModels.message,
    discoveryStatus: 'idle',
    discoveryMessage: 'Discover models through the VS Code API, or explore the public catalog.',
    autoUpdateCatalog: autoUpdate(),
    scores: {
      connected: scoreConnected, loading: false, message: scores.message,
      includeComposites: includeComposites(), snapshot: scores.snapshot,
      links: savedScoreLinks,
    },
  };

  function autoUpdate(): boolean {
    return vscode.workspace.getConfiguration('llmBench').get<boolean>('autoUpdateCatalog', true);
  }

  function includeComposites(): boolean {
    return vscode.workspace.getConfiguration('llmBench').get<boolean>('includeCompositeScores', false);
  }

  function writeScores(operation: () => Promise<void>): Promise<void> {
    const pending = scoreWrites.then(operation);
    scoreWrites = pending.catch(() => {});
    return pending;
  }

  function connectScores(): Promise<boolean> {
    if (connectingScores) return connectingScores;
    if (clearingScores || disposed) return Promise.resolve(false);
    const generation = scoreGeneration;
    const pending = Promise.resolve().then(async () => {
      if (generation !== scoreGeneration || disposed) return false;
      try {
        const key = await vscode.window.showInputBox({
          title: 'Connect OpenRouter Scores', password: true, ignoreFocusOut: true,
          prompt: 'Enter an OpenRouter API key to download public benchmark scores. It is saved in VS Code secret storage. No inference requests are made.',
          validateInput: value => !value || value.length > 512 || /\s/.test(value) ? 'Enter a key without spaces (up to 512 characters).' : undefined,
        });
        if (!key || key.length > 512 || /\s/.test(key) || generation !== scoreGeneration || disposed) return false;
        await writeScores(async () => {
          if (generation !== scoreGeneration || disposed) return;
          await context.secrets.store(SCORE_SECRET, key);
        });
        if (generation !== scoreGeneration || disposed) return false;
        state.scores.connected = true;
        await refreshScores();
        return generation === scoreGeneration && !disposed;
      } catch {
        if (generation === scoreGeneration && !disposed) {
          state.scores.message = 'The API key could not be saved in VS Code secret storage. Try connecting again.';
          sendState();
        }
        return false;
      }
    }).finally(() => { if (connectingScores === pending) connectingScores = undefined; });
    connectingScores = pending;
    return pending;
  }

  function refreshScores(): Promise<void> {
    if (refreshingScores) return refreshingScores;
    if (clearingScores || disposed) return Promise.resolve();
    const generation = scoreGeneration;
    state.scores.loading = true;
    state.scores.message = 'Downloading published benchmark scores…';
    sendState();
    const pending = Promise.resolve().then(async () => {
      if (generation !== scoreGeneration || disposed) return;
      try {
        const key = await context.secrets.get(SCORE_SECRET);
        if (generation !== scoreGeneration || disposed) return;
        state.scores.connected = !!key;
        if (!key) { state.scores.message = 'Connect OpenRouter to download published scores.'; return; }
        await scores.refresh(key, state.scores.includeComposites);
        if (generation !== scoreGeneration || disposed) return;
        state.scores.snapshot = scores.snapshot;
        state.scores.message = scores.message;
      } catch {
        if (generation === scoreGeneration) state.scores.message = 'The saved API key could not be read. Try connecting again.';
      } finally {
        if (generation === scoreGeneration) { state.scores.loading = false; sendState(); }
      }
    }).finally(() => { if (refreshingScores === pending) refreshingScores = undefined; });
    refreshingScores = pending;
    return pending;
  }

  async function requestScores(): Promise<boolean> {
    if (connectingScores) return connectingScores;
    if (clearingScores || disposed) return false;
    const generation = scoreGeneration;
    try {
      const key = await context.secrets.get(SCORE_SECRET);
      if (generation !== scoreGeneration || disposed) return false;
      if (!key) return connectScores();
      await refreshScores();
      return generation === scoreGeneration && !disposed;
    } catch {
      if (generation === scoreGeneration && !disposed) {
        state.scores.message = 'The saved API key could not be read. Try connecting again.';
        sendState();
      }
      return false;
    }
  }

  async function clearScores(): Promise<void> {
    if (clearingScores) return;
    clearingScores = true;
    const generation = ++scoreGeneration;
    connectingScores = undefined;
    refreshingScores = undefined;
    scoreActions.clear();
    state.scores.loading = true;
    state.scores.snapshot = undefined;
    state.scores.links = {};
    state.scores.message = 'Disconnecting and clearing saved scores…';
    sendState();
    const clearing = scores.clear();
    let keyRemoved = false;
    let linksRemoved = false;
    await writeScores(async () => {
      try { await context.secrets.delete(SCORE_SECRET); keyRemoved = true; } catch { /* Report incomplete removal below. */ }
      try { await context.globalState.update(SCORE_LINKS, undefined); linksRemoved = true; } catch { /* Report incomplete removal below. */ }
    });
    const cacheRemoved = await clearing;
    clearingScores = false;
    if (generation !== scoreGeneration || disposed) return;
    state.scores.loading = false;
    if (keyRemoved) state.scores.connected = false;
    state.scores.message = keyRemoved && linksRemoved && cacheRemoved
      ? 'Disconnected. The API key, saved scores, and reference links were removed from this device.'
      : 'Cleared scores for this session, but some saved data could not be removed. Try disconnecting again; saved data may return after restart.';
    sendState();
    if (!keyRemoved || !linksRemoved || !cacheRemoved) void vscode.window.showWarningMessage(state.scores.message);
  }

  function hasScoreEntry(key: string): boolean {
    return state.catalog.models.some(model => JSON.stringify(['catalog', model.id]) === key)
      || [...state.discovered, ...state.localModels].some(model => JSON.stringify(['runtime', runtimeKey(model)]) === key);
  }

  function scoreAction(key: string, action: 'show' | 'link' | 'unlink'): Promise<void> {
    if (clearingScores || disposed || !hasScoreEntry(key)) return Promise.resolve();
    const existing = scoreActions.get(key);
    if (existing && action !== 'unlink') return existing;
    const generation = scoreGeneration;
    const localGeneration = discoveryGeneration;
    const active = (): boolean => scoreActions.get(key) === pending && generation === scoreGeneration && !disposed && hasScoreEntry(key)
      && (!key.startsWith('["runtime",') || localGeneration === discoveryGeneration);
    const pending = Promise.resolve().then(async () => {
      if (!active()) return;
      if (action !== 'unlink' && (action === 'show' || !state.scores.snapshot?.records.some(record =>
        state.scores.includeComposites || !SCORE_METRICS[record.metric].composite))) {
        if (!await requestScores()) return;
      }
      if (!active() || (action === 'show' && state.scores.links[key])) return;
      let reference: string | undefined;
      if (action !== 'unlink') {
        const choices = new Map((state.scores.snapshot?.records ?? [])
          .filter(record => state.scores.includeComposites || !SCORE_METRICS[record.metric].composite)
          .map(record => [record.modelId, { label: record.modelName, description: record.modelId }]));
        if (!choices.size) return;
        const selected = await vscode.window.showQuickPick([...choices.values()].sort((a, b) => a.label.localeCompare(b.label)), {
          title: 'Choose a published reference model', matchOnDescription: true,
          placeHolder: 'Reference scores do not measure your Copilot or organization deployment.',
        });
        if (!selected) return;
        reference = selected.description;
      }
      if (!active()) return;
      await writeScores(async () => {
        if (!active()) return;
        const links = { ...state.scores.links };
        if (reference) links[key] = reference;
        else delete links[key];
        try {
          await context.globalState.update(SCORE_LINKS, links);
          if (active()) state.scores.links = links;
        } catch { void vscode.window.showWarningMessage('The reference link could not be saved on this device. Please try again.'); }
      });
      sendState();
    }).finally(() => { if (scoreActions.get(key) === pending) scoreActions.delete(key); });
    scoreActions.set(key, pending);
    return pending;
  }

  function sendState(): void {
    if (disposed) return;
    for (const webview of readyWebviews) void webview.postMessage({ type: 'state', state } satisfies HostMessage);
  }

  function isVisible(): boolean {
    return !!(panel?.visible || sidebar?.visible);
  }

  function refreshVisibleModels(): void {
    if (hasDetected && modelsDirty && isVisible()) void detectModels();
  }

  async function refreshCatalog(force: boolean): Promise<void> {
    state.catalogLoading = true;
    sendState();
    await store.refresh(force);
    state.catalog = store.catalog;
    state.catalogOrigin = store.origin;
    state.catalogMessage = store.message;
    state.catalogLoading = false;
    sendState();
  }

  function detectModels(): Promise<void> {
    if (detecting) return detecting;
    hasDetected = true;
    modelsDirty = false;
    state.discoveryStatus = 'loading';
    state.discoveryMessage = 'Checking the models exposed by VS Code…';
    sendState();
    const generation = discoveryGeneration;
    detecting = Promise.resolve().then(async () => {
      if (generation !== discoveryGeneration || disposed) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const models = await Promise.race([
          vscode.lm.selectChatModels(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 20_000); }),
        ]);
        if (generation !== discoveryGeneration || disposed) return;
        state.discovered = parseDiscoveredModels(models);
        state.discoveryStatus = models.length ? 'ready' : 'empty';
        state.discoveryMessage = models.length
          ? `${models.length} models exposed by the VS Code API. This may differ from your Copilot picker; availability can depend on plan, policy, and workspace trust.`
          : 'No models were exposed by VS Code. Check provider configuration, sign-in, organization policy, and workspace trust. Your local history and the public catalog remain available.';
        await localModels.remember(state.discovered);
        if (generation !== discoveryGeneration || disposed) return;
        state.localModels = localModels.models;
        state.localModelsMessage = localModels.message;
      } catch {
        if (generation !== discoveryGeneration || disposed) return;
        state.discovered = [];
        state.discoveryStatus = 'error';
        state.discoveryMessage = 'Model discovery did not complete. Check provider configuration or access, then try again. Your local history and the public catalog remain available.';
      } finally {
        clearTimeout(timeout);
        if (generation === discoveryGeneration) {
          detecting = undefined;
          sendState();
          if (modelsDirty && isVisible() && !disposed) queueMicrotask(() => {
            if (generation === discoveryGeneration && hasDetected && isVisible() && !disposed) void detectModels();
          });
        }
      }
    });
    return detecting;
  }

  async function clearLocalModels(): Promise<void> {
    // Invalidate pending discovery so it cannot restore metadata after the user clears it.
    discoveryGeneration++;
    for (const key of scoreActions.keys()) if (key.startsWith('["runtime",')) scoreActions.delete(key);
    detecting = undefined;
    hasDetected = false;
    modelsDirty = false;
    state.discovered = [];
    state.discoveryStatus = 'idle';
    state.discoveryMessage = 'Local model history cleared for this session. Detect models to save them again.';
    const removed = await localModels.clear();
    state.localModels = localModels.models;
    state.localModelsMessage = localModels.message;
    let referencesRemoved = true;
    // Runtime reference keys contain private model identities too.
    await writeScores(async () => {
      const links = Object.fromEntries(Object.entries(state.scores.links).filter(([key]) => !key.startsWith('["runtime",')));
      state.scores.links = links;
      try { await context.globalState.update(SCORE_LINKS, Object.keys(links).length ? links : undefined); }
      catch {
        referencesRemoved = false;
        state.localModelsMessage += ' Saved score references could not be removed and may return after restart. Try clearing local models again.';
      }
    });
    sendState();
    if (!removed || !referencesRemoved) void vscode.window.showWarningMessage(state.localModelsMessage);
  }

  async function openPicker(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open');
      await vscode.commands.executeCommand('workbench.action.chat.openModelPicker');
    } catch {
      void vscode.window.showInformationMessage('Open Copilot Chat, then select a model using the picker beside the chat input. Your plan or organization may limit manual selection.');
    }
  }

  async function openExternal(url: string | undefined): Promise<void> {
    if (url && isSafeExternalUrl(url)) {
      if (!await vscode.env.openExternal(vscode.Uri.parse(url))) {
        void vscode.window.showWarningMessage('The source could not be opened in your browser.');
      }
    }
  }

  function attach(webview: vscode.Webview): vscode.Disposable {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    };
    const nonce = randomBytes(18).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.css'));
    webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};">
<title>ModelBeacon</title><link rel="stylesheet" href="${style}"></head>
<body><main id="app"><p>Loading model evidence…</p></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
    const listener = webview.onDidReceiveMessage(async (message: unknown) => {
      if (disposed || !isWebviewRequest(message)) return;
      try {
        switch (message.type) {
          case 'ready': readyWebviews.add(webview); sendState(); break;
          case 'detectModels': await detectModels(); break;
          case 'clearLocalModels': await clearLocalModels(); break;
          case 'refreshCatalog': await refreshCatalog(true); break;
          case 'openPicker': await openPicker(); break;
          case 'openSource': await openExternal(state.catalog.sources.find(source => source.id === message.sourceId)?.url); break;
          case 'openHelp': await openExternal(HELP[message.topic]); break;
          case 'connectScores': await connectScores(); break;
          case 'refreshScores': await refreshScores(); break;
          case 'clearScores': await clearScores(); break;
          case 'showScores': await scoreAction(message.key, 'show'); break;
          case 'linkScores': await scoreAction(message.key, 'link'); break;
          case 'unlinkScores': await scoreAction(message.key, 'unlink'); break;
          case 'openScoreSource': await openExternal(SCORE_METRICS[message.metric].sourceUrl); break;
          case 'setCompositeScores':
            await vscode.workspace.getConfiguration('llmBench').update('includeCompositeScores', message.enabled, vscode.ConfigurationTarget.Global);
            break;
          case 'setAutoUpdate':
            await vscode.workspace.getConfiguration('llmBench').update('autoUpdateCatalog', message.enabled, vscode.ConfigurationTarget.Global);
            break;
        }
      } catch {
        void vscode.window.showWarningMessage('ModelBeacon could not complete that action. Please try again.');
      }
    });
    return { dispose: () => { readyWebviews.delete(webview); listener.dispose(); } };
  }

  function open(): void {
    if (panel) {
      panel.reveal();
    } else {
      const editor = vscode.window.createWebviewPanel('llmBench.explorer', 'ModelBeacon', vscode.ViewColumn.Active);
      panel = editor;
      const connection = attach(editor.webview);
      const visibility = editor.onDidChangeViewState(() => {
        if (!editor.visible) readyWebviews.delete(editor.webview);
        refreshVisibleModels();
      });
      editor.onDidDispose(() => {
        if (panel === editor) panel = undefined;
        connection.dispose();
        visibility.dispose();
      });
    }
    refreshVisibleModels();
    if (autoUpdate()) void refreshCatalog(false);
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('llmBench.home', {
      resolveWebviewView(view) {
        sidebar = view;
        const connection = attach(view.webview);
        sidebarConnection = connection;
        const visibility = view.onDidChangeVisibility(() => {
          if (!view.visible) readyWebviews.delete(view.webview);
          refreshVisibleModels();
        });
        view.onDidDispose(() => {
          if (sidebar === view) { sidebar = undefined; sidebarConnection = undefined; }
          connection.dispose();
          visibility.dispose();
        });
        refreshVisibleModels();
        if (autoUpdate()) void refreshCatalog(false);
      },
    }),
    vscode.commands.registerCommand('llmBench.open', open),
    vscode.commands.registerCommand('llmBench.refreshModels', async () => { open(); await detectModels(); }),
    vscode.commands.registerCommand('llmBench.clearLocalModels', clearLocalModels),
    vscode.commands.registerCommand('llmBench.refreshCatalog', async () => { open(); await refreshCatalog(true); }),
    vscode.commands.registerCommand('llmBench.connectScores', connectScores),
    vscode.commands.registerCommand('llmBench.refreshScores', refreshScores),
    vscode.commands.registerCommand('llmBench.clearScores', clearScores),
    vscode.lm.onDidChangeChatModels(() => {
      modelsDirty = true;
      if (hasDetected && isVisible() && !detecting) void detectModels();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('llmBench.includeCompositeScores')) state.scores.includeComposites = includeComposites();
      if (event.affectsConfiguration('llmBench.autoUpdateCatalog')) {
        state.autoUpdateCatalog = autoUpdate();
        if (state.autoUpdateCatalog && (panel || sidebar)) void refreshCatalog(false);
      }
      sendState();
    }),
    { dispose: () => { disposed = true; scoreGeneration++; panel?.dispose(); sidebarConnection?.dispose(); readyWebviews.clear(); } },
  );
}
