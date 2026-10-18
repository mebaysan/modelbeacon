import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { runtimeKey } from '../src/core.ts';
import { SCORE_DATA_LINKS, SCORE_METRICS } from '../src/scores.ts';
import type { ExplorerState, HostMessage } from '../src/types.ts';

const bundled = await readFile(new URL('../data/catalog.json', import.meta.url));
const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: ['src/extension.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
  external: ['vscode'], define: { __CATALOG_URL__: '""' },
});

function surface() {
  let receive: ((message: unknown) => Promise<void>) | undefined;
  let onDispose = () => {};
  let onVisibility = () => {};
  let disposed = false;
  const states: ExplorerState[] = [];
  const view = {
    visible: true,
    reveal() { view.visible = true; onVisibility(); },
    dispose() { disposed = true; onDispose(); },
    onDidDispose(action: () => void) { onDispose = action; return { dispose() { onDispose = () => {}; } }; },
    onDidChangeViewState(action: () => void) { onVisibility = action; return { dispose() { onVisibility = () => {}; } }; },
    onDidChangeVisibility(action: () => void) { onVisibility = action; return { dispose() { onVisibility = () => {}; } }; },
    webview: {
      html: '', options: {}, cspSource: 'https://webview.example',
      asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage(action: NonNullable<typeof receive>) {
        receive = action;
        return { dispose() { receive = undefined; } };
      },
      postMessage(message: HostMessage) {
        assert.equal(disposed, false, 'Disposed webviews must not receive messages');
        states.push(structuredClone(message.state));
        return Promise.resolve(true);
      },
    },
  };
  return {
    view, states,
    state: () => states.at(-1)!,
    async send(message: unknown) { assert.ok(receive, 'Webview message listener must be attached'); await receive(message); },
    setVisible(visible: boolean) { view.visible = visible; onVisibility(); },
  };
}

interface HostOptions {
  fetcher?: typeof fetch;
  input?: () => Promise<string | undefined>;
  pick?: (items: unknown[]) => Promise<unknown>;
  secrets?: Map<string, string>;
  beforeSecretStore?: () => Promise<void>;
  unreadableLinks?: boolean;
  file?: { path: string; data: string; size?: number };
}

async function host(discover: (...args: unknown[]) => Promise<unknown[]>, saved = new Map<string, unknown>(), openEditor = true, options: HostOptions = {}) {
  const commands = new Map<string, () => unknown>();
  let modelsChanged: () => void;
  let editor: ReturnType<typeof surface>;
  let provider: { resolveWebviewView: (view: ReturnType<typeof surface>['view']) => void };
  let editorsCreated = 0;
  let failWrites = false;
  let failSecrets = false;
  let configurationChanged: (event: { affectsConfiguration: (name: string) => boolean }) => void;
  const configuration = new Map<string, unknown>([['autoUpdateCatalog', false], ['includeCompositeScores', false]]);
  const secrets = options.secrets ?? new Map<string, string>();
  const inputs: unknown[] = [];
  const picks: unknown[][] = [];
  const pickOptions: unknown[] = [];
  const warnings: string[] = [];
  const openedUrls: string[] = [];
  const fileDialogs: unknown[] = [];
  let fileReads = 0;
  const subscriptions: { dispose(): void }[] = [];
  const disposable = { dispose() {} };
  const vscode = {
    workspace: {
      fs: {
        readFile: async (uri: unknown) => {
          if (typeof uri === 'string') return bundled;
          fileReads++;
          return Buffer.from(options.file?.data ?? '');
        },
        stat: async () => ({ size: options.file?.size ?? Buffer.byteLength(options.file?.data ?? '') }),
      },
      getConfiguration: () => ({
        get: (name: string, fallback: unknown) => configuration.has(name) ? configuration.get(name) : fallback,
        update: async (name: string, value: unknown) => {
          configuration.set(name, value);
          configurationChanged({ affectsConfiguration: key => key === `llmBench.${name}` });
        },
      }),
      onDidChangeConfiguration: (action: typeof configurationChanged) => { configurationChanged = action; return disposable; },
    },
    Uri: { joinPath: (...parts: unknown[]) => parts.join('/'), parse: (url: string) => url },
    env: { openExternal: async (url: string) => { openedUrls.push(url); return true; } },
    ViewColumn: { Active: 1 },
    ConfigurationTarget: { Global: 1 },
    commands: { registerCommand: (name: string, action: () => unknown) => { commands.set(name, action); return disposable; } },
    lm: {
      selectChatModels: discover,
      onDidChangeChatModels: (action: () => void) => { modelsChanged = action; return disposable; },
    },
    window: {
      registerWebviewViewProvider: (id: string, registered: typeof provider) => {
        assert.equal(id, 'llmBench.home');
        provider = registered;
        return disposable;
      },
      createWebviewPanel: (_id: string, title: string) => {
        assert.equal(title, 'ModelBeacon');
        editorsCreated++;
        editor = surface();
        return editor.view;
      },
      showWarningMessage: (message: string) => { warnings.push(message); },
      showInputBox: async (input: unknown) => { inputs.push(input); return options.input?.(); },
      showOpenDialog: async (input: unknown) => { fileDialogs.push(input); return options.file ? [{ path: options.file.path }] : undefined; },
      showQuickPick: async (items: unknown[], settings: unknown) => { picks.push(items); pickOptions.push(settings); return options.pick?.(items); },
    },
  };
  const loaded = { exports: {} as { activate: (context: unknown) => Promise<void> } };
  new Function('require', 'module', 'exports', 'fetch', compiled.outputFiles[0].text)(
    (id: string) => id === 'vscode' ? vscode : require(id), loaded, loaded.exports,
    options.fetcher ?? (async () => assert.fail('No automatic network requests')),
  );
  await loaded.exports.activate({
    extensionUri: '/extension', subscriptions,
    secrets: {
      get: async (key: string) => secrets.get(key),
      store: async (key: string, value: string) => { if (failSecrets) throw new Error('Secret storage unavailable'); await options.beforeSecretStore?.(); secrets.set(key, value); },
      delete: async (key: string) => { if (failSecrets) throw new Error('Secret storage unavailable'); secrets.delete(key); },
      onDidChange: () => disposable,
    },
    globalState: {
      get: (key: string) => { if (key === 'scoreLinks.v1' && options.unreadableLinks) throw new Error('Unreadable links'); return structuredClone(saved.get(key)); },
      update: async (key: string, value: unknown) => {
        if (failWrites) throw new Error('Storage unavailable');
        if (value === undefined) saved.delete(key);
        else saved.set(key, structuredClone(value));
      },
    },
  });
  if (openEditor) {
    await commands.get('llmBench.open')!();
    await editor!.send({ type: 'ready' });
  }
  return {
    command: async (name: string) => { assert.ok(commands.has(name)); await commands.get(name)!(); },
    state: () => editor.state(),
    editor: () => editor,
    editorsCreated: () => editorsCreated,
    resolveSidebar: () => {
      const sidebar = surface();
      provider.resolveWebviewView(sidebar.view);
      return sidebar;
    },
    changed: () => modelsChanged(),
    saved,
    secrets,
    inputs,
    picks,
    pickOptions,
    warnings,
    openedUrls,
    fileDialogs,
    fileReads: () => fileReads,
    failWrites: (failed = true) => { failWrites = failed; },
    failSecrets: () => { failSecrets = true; },
    close: () => editor.view.dispose(),
    dispose: () => { for (const subscription of subscriptions) subscription.dispose(); },
  };
}

const custom = {
  id: 'organization-model', name: 'Organization model', vendor: 'customendpoint',
  family: 'custom', version: '1', maxInputTokens: 128_000,
};

function extraCatalog(id = 'private-coder') {
  return {
    schemaVersion: 1, revision: '2026-10-17.1', reviewedAt: '2026-10-17', benchmarks: [],
    sources: [{ id: 'docs', title: 'Organization documentation', url: 'https://example.com/models',
      license: 'Internal', licenseUrl: 'https://example.com/license', retrievedAt: '2026-10-17' }],
    models: [{ id, name: 'Private Coder', provider: 'Organization', aliases: [],
      facts: [{ text: 'Organization-provided model.', sourceId: 'docs' }], guidance: [] }],
  };
}

test('URL catalog appends through a native prompt, restores offline, and hides its private URL from the webview', async () => {
  let downloads = 0;
  const url = 'https://example.com/private/catalog.json?access=private-value';
  const app = await host(async () => [], new Map(), true, {
    input: async () => url,
    fetcher: async (request, options) => {
      downloads++;
      assert.equal(request, url);
      assert.equal(options?.redirect, 'error');
      assert.equal(options?.credentials, 'omit');
      return new Response(JSON.stringify(extraCatalog()));
    },
  });
  const baseIds = app.state().catalog.models.map(model => model.id);
  await app.editor().send({ type: 'addCatalogUrl', url: 'https://unrequested.example' });
  assert.equal(downloads, 0, 'Webview cannot supply arbitrary URLs');
  await app.command('llmBench.addCatalogUrl');
  assert.equal(downloads, 1);
  assert.deepEqual(app.state().catalog.models.map(model => model.id), [...baseIds, 'private-coder']);
  assert.equal(app.state().extraCatalogs[0].kind, 'url');
  assert.equal(app.state().catalog.models.at(-1)?.catalogLabel, 'example.com');
  assert.doesNotMatch(JSON.stringify(app.state()), /private-value|private\/catalog/);
  const restored = await host(async () => [], app.saved);
  assert.equal(restored.state().catalog.models.at(-1)?.id, 'private-coder');
  assert.equal(restored.state().extraCatalogs.length, 1);
  await app.command('llmBench.refreshExtraCatalogs');
  assert.equal(downloads, 2);
});

test('JSON imports read only the chosen file, validate before appending, and reject oversize files before reading', async () => {
  const file = { path: '/private/folder/company.json', data: JSON.stringify(extraCatalog()) };
  const app = await host(async () => [], new Map(), true, { file });
  await app.editor().send({ type: 'importCatalogFile', path: file.path });
  assert.equal(app.fileDialogs.length, 0);
  await app.command('llmBench.importCatalogFile');
  assert.equal(app.fileReads(), 1);
  assert.equal(app.fileDialogs.length, 1);
  assert.equal(app.state().extraCatalogs[0].label, 'company.json');
  assert.equal(app.state().catalog.models.at(-1)?.id, 'private-coder');
  assert.doesNotMatch(JSON.stringify([...app.saved.values()]), /private\/folder/);
  const baseCount = app.state().catalog.models.length;
  file.data = '{bad json}';
  await app.command('llmBench.importCatalogFile');
  assert.equal(app.state().catalog.models.length, baseCount);
  assert.match(app.state().extraCatalogsMessage, /valid ModelBeacon catalog JSON/);
  const large = await host(async () => [], new Map(), true, { file: { ...file, size: 2 * 1024 * 1024 + 1 } });
  await large.command('llmBench.importCatalogFile');
  assert.equal(large.fileReads(), 0);
  assert.equal(large.state().extraCatalogs.length, 0);
});

test('removing an appended catalog updates both views and removes only its orphaned score references', async () => {
  const extraKey = JSON.stringify(['catalog', 'private-coder']);
  const baseId = JSON.parse(bundled.toString()).models[0].id;
  const baseKey = JSON.stringify(['catalog', baseId]);
  const retiredKey = JSON.stringify(['catalog', 'previously-removed-private-model']);
  const saved = new Map<string, unknown>([['scoreLinks.v1', { [extraKey]: 'vendor/private-model', [baseKey]: 'vendor/public-model', [retiredKey]: 'vendor/retired-private' }]]);
  const app = await host(async () => [], saved, true, {
    file: { path: '/private/company.json', data: JSON.stringify(extraCatalog()) },
  });
  await app.command('llmBench.importCatalogFile');
  const sidebar = app.resolveSidebar();
  await sidebar.send({ type: 'ready' });
  const id = app.state().extraCatalogs[0].id;
  await sidebar.send({ type: 'removeExtraCatalog', id });
  for (const state of [app.state(), sidebar.state()]) {
    assert.equal(state.extraCatalogs.length, 0);
    assert.equal(state.catalog.models.some(model => model.id === 'private-coder'), false);
    assert.equal(state.scores.links[extraKey], undefined);
    assert.equal(state.scores.links[baseKey], 'vendor/public-model');
  }
  assert.deepEqual(app.saved.get('scoreLinks.v1'), { [baseKey]: 'vendor/public-model' });
  const restored = await host(async () => [], app.saved);
  assert.equal(restored.state().extraCatalogs.length, 0);
});

test('cancelling catalog prompts keeps storage and the base catalog unchanged', async () => {
  const app = await host(async () => []);
  await app.command('llmBench.addCatalogUrl');
  await app.command('llmBench.importCatalogFile');
  assert.equal(app.state().extraCatalogs.length, 0);
  assert.equal(app.saved.has('extraCatalogs.v1'), false);
});

test('host discovers every provider, persists only metadata, and restores it without discovery', async () => {
  const app = await host(async (...args) => {
    assert.deepEqual(args, [], 'No Copilot vendor filter');
    return [{ ...custom, apiKey: 'must-not-save', endpoint: 'must-not-save', sendRequest: () => assert.fail('No inference') }];
  });
  await app.command('llmBench.refreshModels');
  assert.deepEqual(app.state().discovered, [custom]);
  assert.equal(app.state().localModels.length, 1);
  assert.equal(JSON.stringify([...app.saved.values()]).includes('must-not-save'), false);
  const restored = await host(async () => assert.fail('No automatic discovery on restart'), app.saved);
  assert.equal(restored.state().localModels[0].id, custom.id);
  assert.equal(restored.state().discoveryStatus, 'idle');
  assert.deepEqual(restored.state().discovered, []);
});

test('failed and empty discovery preserve history without claiming cached models are available', async () => {
  let response: 'models' | 'empty' | 'error' = 'models';
  const app = await host(async () => {
    if (response === 'error') throw new Error('Provider unavailable');
    return response === 'models' ? [custom] : [];
  });
  await app.command('llmBench.refreshModels');
  for (const next of ['empty', 'error'] as const) {
    response = next;
    await app.command('llmBench.refreshModels');
    assert.equal(app.state().discoveryStatus, next);
    assert.deepEqual(app.state().discovered, []);
    assert.equal(app.state().localModels[0].id, custom.id);
  }
});

test('clear invalidates pending discovery and automatic refresh until the next explicit detection', async () => {
  let finish: (models: unknown[]) => void;
  let started: () => void;
  let calls = 0;
  const pending = new Promise<unknown[]>(resolve => { finish = resolve; });
  const called = new Promise<void>(resolve => { started = resolve; });
  const app = await host(async () => { calls++; started(); return pending; });
  const detecting = app.command('llmBench.refreshModels');
  await called;
  await app.command('llmBench.clearLocalModels');
  finish!([custom]);
  await detecting;
  app.changed();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(app.state().localModels, []);
  assert.deepEqual(app.state().discovered, []);
  assert.equal(app.state().discoveryStatus, 'idle');
  const restored = await host(async () => [], app.saved);
  assert.deepEqual(restored.state().localModels, []);
  await app.command('llmBench.refreshModels');
  assert.equal(calls, 2);
  assert.equal(app.state().localModels[0].id, custom.id);
});

test('failed persistent deletion warns even when the explorer is closed', async () => {
  const app = await host(async () => [custom]);
  await app.command('llmBench.refreshModels');
  app.close();
  app.failWrites();
  await app.command('llmBench.clearLocalModels');
  assert.equal(app.warnings.length, 1);
  assert.match(app.warnings[0], /saved data could not be removed/);
  assert.match(app.warnings[0], /may return after restarting/);
});

test('Activity Bar sidebar resolves the shared homepage without opening an editor or discovering', async () => {
  const app = await host(async () => assert.fail('Sidebar resolution must not discover models'), new Map(), false);
  assert.equal(app.editorsCreated(), 0);
  const sidebar = app.resolveSidebar();
  assert.equal(app.editorsCreated(), 0);
  assert.equal(sidebar.states.length, 0, 'Wait for this webview to become ready');
  assert.match(sidebar.view.webview.html, /<title>ModelBeacon<\/title>/);
  assert.match(sidebar.view.webview.html, /Content-Security-Policy/);
  assert.match(sidebar.view.webview.html, /script-src 'nonce-/);
  await sidebar.send({ type: 'ready' });
  assert.equal(sidebar.state().discoveryStatus, 'idle');
  assert.ok(sidebar.state().catalog.models.length > 0);
  assert.equal(app.editorsCreated(), 0);
});

test('sidebar and editor have independent readiness and receive the same metadata updates', async () => {
  const app = await host(async () => [custom]);
  const sidebar = app.resolveSidebar();
  await app.command('llmBench.refreshModels');
  assert.equal(sidebar.states.length, 0);
  assert.equal(app.state().localModels.length, 1);
  await sidebar.send({ type: 'ready' });
  assert.deepEqual(sidebar.state(), app.state());
  await sidebar.send({ type: 'clearLocalModels' });
  assert.deepEqual(sidebar.state().localModels, []);
  assert.deepEqual(app.state().localModels, []);
  await sidebar.send({ type: 'detectModels' });
  assert.deepEqual(sidebar.state(), app.state());
  assert.equal(app.editorsCreated(), 1);
});

test('disposing either surface leaves the other working and new editors start unready', async () => {
  const app = await host(async () => [custom]);
  const sidebar = app.resolveSidebar();
  await sidebar.send({ type: 'ready' });
  app.close();
  await sidebar.send({ type: 'detectModels' });
  assert.equal(sidebar.state().localModels.length, 1);
  assert.equal(app.editorsCreated(), 1, 'Sidebar action must not create an editor');
  await app.command('llmBench.open');
  assert.equal(app.editorsCreated(), 2);
  assert.equal(app.editor().states.length, 0);
  await app.editor().send({ type: 'ready' });
  assert.equal(app.state().localModels.length, 1);
  sidebar.view.dispose();
  await app.editor().send({ type: 'clearLocalModels' });
  assert.deepEqual(app.state().localModels, []);
  await app.command('llmBench.open');
  assert.equal(app.editorsCreated(), 2, 'Open in Editor must reuse the existing panel');
});

test('both surfaces reject unknown actions and unexpected action payloads', async () => {
  let discoveries = 0;
  const app = await host(async () => { discoveries++; return [custom]; });
  const sidebar = app.resolveSidebar();
  await sidebar.send({ type: 'ready' });
  for (const view of [app.editor(), sidebar]) {
    await view.send({ type: 'detectModels', endpoint: 'https://unexpected.example' });
    await view.send({ type: 'executeCommand', command: 'bad' });
    await view.send(null);
  }
  assert.equal(discoveries, 0);
  assert.equal(app.warnings.length, 0);
});

test('model changes refresh a visible sidebar and wait while all surfaces are hidden', async () => {
  let discoveries = 0;
  const app = await host(async () => { discoveries++; return [{ ...custom, name: `Model ${discoveries}` }]; }, new Map(), false);
  const sidebar = app.resolveSidebar();
  await sidebar.send({ type: 'ready' });
  await sidebar.send({ type: 'detectModels' });
  app.changed();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(discoveries, 2);
  assert.equal(sidebar.state().discovered[0].name, 'Model 2');
  sidebar.setVisible(false);
  app.changed();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(discoveries, 2);
  const messages = sidebar.states.length;
  sidebar.setVisible(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(discoveries, 3);
  assert.equal(sidebar.states.length, messages, 'Recreated document must announce readiness');
  await sidebar.send({ type: 'ready' });
  assert.equal(sidebar.state().discovered[0].name, 'Model 3');
  assert.equal(app.editorsCreated(), 0);
});

function scoreResponse(url: string | URL | Request): Response {
  const query = new URL(String(url)).searchParams;
  const identity = { model_permaslug: 'vendor/public-example-1', display_name: 'Public Example 1' };
  const data = query.get('source') === 'artificial-analysis'
    ? [{ ...identity, source: 'artificial-analysis', intelligence_index: 112.5, coding_index: 60, agentic_index: null }]
    : [{ ...identity, source: 'openrouter', benchmark_type: query.get('benchmark_type'), accuracy: 0.75,
      accuracy_stddev: 0.025, total_tasks: 100, last_run_timestamp: '2026-10-17T00:00:00Z' }];
  return new Response(JSON.stringify({ data, meta: { as_of: '2026-10-17T00:00:00Z', citation: 'Published by the evaluation provider via OpenRouter.' } }));
}

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(release => { resolve = release; });
  return { promise, resolve };
}

const customScoreKey = JSON.stringify(['runtime', runtimeKey(custom)]);
const scoreOptions: HostOptions = { input: async () => 'test-openrouter-secret', fetcher: async url => scoreResponse(url), pick: async items => items[0] };

test('score license and attribution open fixed links and reject webview-supplied destinations', async () => {
  const app = await host(async () => []);
  await app.editor().send({ type: 'openScoreInfo', topic: 'license' });
  await app.editor().send({ type: 'openScoreInfo', topic: 'attribution' });
  await app.editor().send({ type: 'openScoreSource', metric: 'gpqa' });
  assert.deepEqual(app.openedUrls, [SCORE_DATA_LINKS.license, SCORE_DATA_LINKS.attribution, SCORE_METRICS.gpqa.sourceUrl]);
  for (const message of [
    { type: 'openScoreInfo', topic: 'license', url: 'https://unrequested.example' },
    { type: 'openScoreInfo', topic: 'constructor' },
    { type: 'openScoreSource', metric: 'gpqa', url: 'https://unrequested.example' },
    { type: 'openScoreSource', metric: 'gpqa', modelId: 'vendor/example', url: 'https://unrequested.example' },
  ]) await app.editor().send(message);
  assert.equal(app.openedUrls.length, 3);
  assert.equal(app.inputs.length, 0);
});

test('score sources resolve exact cached references and retain legacy links without fetching or prompting', async () => {
  const identity = { modelId: 'vendor/example', modelName: 'Example', value: 75, sampleSize: 100, evaluatedAt: '2026-10-17T00:00:00.000Z' };
  const snapshot = {
    asOf: '2026-10-17T00:00:00.000Z', fetchedAt: '2026-10-17T00:00:00.000Z', includesComposites: false,
    records: [
      { ...identity, metric: 'gpqa', source: 'Evaluation provider', sourceUrl: 'https://example.com/evaluations/gpqa', sourceVersion: 'v2' },
      { ...identity, metric: 'toolUse' },
    ],
  };
  let downloads = 0;
  const app = await host(async () => [], new Map([['scoreCache.v1', snapshot]]), true, {
    fetcher: async () => { downloads++; throw new Error('No score refresh expected'); },
  });
  await app.editor().send({ type: 'openScoreSource', metric: 'gpqa', modelId: 'vendor/example' });
  await app.editor().send({ type: 'openScoreSource', metric: 'toolUse', modelId: 'vendor/example' });
  await app.editor().send({ type: 'openScoreSource', metric: 'coding', modelId: 'vendor/example' });
  await app.editor().send({ type: 'openScoreSource', metric: 'gpqa', modelId: 'vendor/unknown' });
  assert.deepEqual(app.openedUrls, ['https://example.com/evaluations/gpqa', SCORE_METRICS.toolUse.sourceUrl]);
  assert.deepEqual(app.state().scores.snapshot, snapshot);
  assert.deepEqual(app.saved.get('scoreCache.v1'), snapshot);
  assert.equal(downloads, 0);
  assert.equal(app.inputs.length, 0);
  assert.equal(app.picks.length, 0);
});

test('score connection keeps the key in SecretStorage and sends no workspace or private model identity', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const app = await host(async () => [custom], new Map(), true, {
    ...scoreOptions, fetcher: async (url, options) => { calls.push({ url: String(url), options: options! }); return scoreResponse(url); },
  });
  assert.equal(app.state().scores.connected, false);
  assert.equal(app.state().scores.includeComposites, false);
  await app.command('llmBench.refreshModels');
  assert.equal(calls.length, 0);
  await app.command('llmBench.connectScores');
  assert.equal(app.secrets.get('openRouterApiKey'), 'test-openrouter-secret');
  assert.equal((app.inputs[0] as { password: boolean }).password, true);
  assert.equal(app.state().scores.connected, true);
  assert.equal(app.state().scores.snapshot?.records.length, 2);
  assert.deepEqual(app.state().scores.links, {});
  assert.deepEqual(calls.map(call => call.url), [
    'https://openrouter.ai/api/v1/benchmarks?source=openrouter&benchmark_type=gpqa_diamond',
    'https://openrouter.ai/api/v1/benchmarks?source=openrouter&benchmark_type=tau_bench_verified_airline',
  ]);
  for (const call of calls) {
    assert.equal(call.options.body, undefined);
    assert.deepEqual(call.options.headers, { Authorization: 'Bearer test-openrouter-secret' });
    assert.doesNotMatch(JSON.stringify(call), /organization-model|customendpoint/);
  }
  assert.doesNotMatch(JSON.stringify(app.editor().states), /test-openrouter-secret/);
  assert.doesNotMatch(JSON.stringify([...app.saved.values()]), /test-openrouter-secret/);
  assert.ok(app.saved.has('scoreCache.v1'));
  const restored = await host(async () => assert.fail('No discovery'), app.saved, true, { secrets: app.secrets });
  assert.equal(restored.state().scores.connected, true);
  assert.equal(restored.state().scores.snapshot?.records.length, 2);
});

test('linking score references is explicit, persists per runtime identity and rejects nonexistent rows', async () => {
  const app = await host(async () => [custom], new Map(), true, scoreOptions);
  await app.command('llmBench.refreshModels');
  await app.command('llmBench.connectScores');
  assert.deepEqual(app.state().scores.links, {});
  await app.editor().send({ type: 'linkScores', key: JSON.stringify(['runtime', 'unknown-model']) });
  assert.equal(app.picks.length, 0);
  await app.editor().send({ type: 'linkScores', key: customScoreKey });
  assert.equal(app.picks.length, 1);
  assert.equal(app.state().scores.links[customScoreKey], 'vendor/public-example-1');
  assert.equal((app.saved.get('scoreLinks.v1') as Record<string, string>)[customScoreKey], 'vendor/public-example-1');
  const restored = await host(async () => [], app.saved, true, { secrets: app.secrets });
  assert.equal(restored.state().scores.links[customScoreKey], 'vendor/public-example-1');
  await app.editor().send({ type: 'unlinkScores', key: customScoreKey });
  assert.equal(app.state().scores.links[customScoreKey], undefined);
});

test('clearing scores removes its key, cache and links while preserving catalog and custom-model history', async () => {
  const app = await host(async () => [custom], new Map(), true, scoreOptions);
  await app.command('llmBench.refreshModels');
  await app.command('llmBench.connectScores');
  await app.editor().send({ type: 'linkScores', key: customScoreKey });
  const catalog = app.state().catalog;
  const local = app.saved.get('localModels.v1');
  await app.command('llmBench.clearScores');
  assert.equal(app.secrets.has('openRouterApiKey'), false);
  assert.equal(app.saved.has('scoreCache.v1'), false);
  assert.equal(app.saved.has('scoreLinks.v1'), false);
  assert.equal(app.state().scores.connected, false);
  assert.equal(app.state().scores.snapshot, undefined);
  assert.deepEqual(app.state().scores.links, {});
  assert.deepEqual(app.state().catalog, catalog);
  assert.deepEqual(app.saved.get('localModels.v1'), local);
  assert.deepEqual(app.state().discovered, [custom]);
});

test('cancelled and superseded native key dialogs cannot connect or restore cleared credentials', async () => {
  const cancelled = await host(async () => []);
  await cancelled.command('llmBench.connectScores');
  assert.equal(cancelled.secrets.size, 0);
  const entered = gate<string | undefined>();
  const started = gate<void>();
  const app = await host(async () => [], new Map(), true, {
    input: async () => { started.resolve(); return entered.promise; },
  });
  const connecting = app.command('llmBench.connectScores');
  await started.promise;
  await app.command('llmBench.clearScores');
  entered.resolve('test-openrouter-secret');
  await connecting;
  assert.equal(app.secrets.size, 0);
  assert.equal(app.state().scores.connected, false);
  assert.equal(app.state().scores.snapshot, undefined);
});

test('clearing during score download or a reference picker cannot restore old results or links', async () => {
  const responseGate = gate<void>();
  const fetching = gate<void>();
  const app = await host(async () => [], new Map(), true, {
    ...scoreOptions, fetcher: async url => { fetching.resolve(); await responseGate.promise; return scoreResponse(url); },
  });
  const connecting = app.command('llmBench.connectScores');
  await fetching.promise;
  await app.command('llmBench.clearScores');
  responseGate.resolve();
  await connecting;
  assert.equal(app.saved.has('scoreCache.v1'), false);
  assert.equal(app.state().scores.snapshot, undefined);
  assert.equal(app.state().scores.loading, false);
  const choice = gate<void>();
  const choosing = gate<void>();
  const linked = await host(async () => [custom], new Map(), true, {
    ...scoreOptions, pick: async items => { choosing.resolve(); await choice.promise; return items[0]; },
  });
  await linked.command('llmBench.refreshModels');
  await linked.command('llmBench.connectScores');
  const linking = linked.editor().send({ type: 'linkScores', key: customScoreKey });
  await choosing.promise;
  await linked.command('llmBench.clearScores');
  choice.resolve();
  await linking;
  assert.equal(linked.saved.has('scoreLinks.v1'), false);
  assert.deepEqual(linked.state().scores.links, {});
});

test('failed secret or local-score removal reports that persisted data may return', async () => {
  for (const failure of ['secret', 'storage']) {
    const app = await host(async () => [custom], new Map(), true, scoreOptions);
    await app.command('llmBench.connectScores');
    if (failure === 'secret') app.failSecrets();
    else app.failWrites();
    await app.command('llmBench.clearScores');
    assert.equal(app.state().scores.snapshot, undefined);
    assert.match(`${app.state().scores.message} ${app.warnings.join(' ')}`, /could not|may return|restart/i);
    assert.equal(failure === 'secret' ? app.secrets.has('openRouterApiKey') : app.saved.has('scoreCache.v1'), true);
    assert.doesNotMatch(JSON.stringify(app.editor().states), /test-openrouter-secret/);
  }
});

test('composite preference is explicit and changing it does not download until refresh', async () => {
  const calls: string[] = [];
  const app = await host(async () => [], new Map(), true, {
    ...scoreOptions, fetcher: async url => { calls.push(String(url)); return scoreResponse(url); },
  });
  await app.command('llmBench.connectScores');
  assert.equal(calls.length, 2);
  await app.editor().send({ type: 'setCompositeScores', enabled: true });
  assert.equal(app.state().scores.includeComposites, true);
  assert.equal(calls.length, 2);
  await app.command('llmBench.refreshScores');
  assert.equal(calls.length, 5);
  assert.equal(app.state().scores.snapshot?.records.find(row => row.metric === 'intelligence')?.value, 112.5);
  await app.editor().send({ type: 'setCompositeScores', enabled: false });
  assert.equal(app.state().scores.includeComposites, false);
  assert.equal(calls.length, 5);
  await app.command('llmBench.refreshScores');
  assert.equal(calls.length, 7);
  assert.ok(app.state().scores.snapshot?.records.every(row => row.metric === 'gpqa' || row.metric === 'toolUse'));
});

test('invalid and unreadable reference caches cannot prevent browsing or introduce prototype keys', async () => {
  const validKey = JSON.stringify(['catalog', 'public-example']);
  const invalidValueKey = JSON.stringify(['catalog', 'invalid-value']);
  const input = JSON.parse('{"__proto__":"vendor/example","constructor":"vendor/example","unknown":"vendor/example"}') as Record<string, unknown>;
  input[validKey] = 'vendor/public-example-1';
  input[invalidValueKey] = 5;
  const app = await host(async () => [], new Map([['scoreLinks.v1', input]]));
  assert.deepEqual(app.state().scores.links, { [validKey]: 'vendor/public-example-1' });
  for (const invalid of [null, [], 'invalid']) {
    const restored = await host(async () => [], new Map([['scoreLinks.v1', invalid]]));
    assert.deepEqual(restored.state().scores.links, {});
    assert.ok(restored.state().catalog.models.length > 0);
  }
  const unreadable = await host(async () => [], new Map(), true, { unreadableLinks: true });
  assert.deepEqual(unreadable.state().scores.links, {});
  assert.ok(unreadable.state().catalog.models.length > 0);
});

test('failed key storage does not claim connection or make benchmark requests', async () => {
  const app = await host(async () => [], new Map(), true, { input: scoreOptions.input });
  app.failSecrets();
  await app.command('llmBench.connectScores');
  assert.equal(app.state().scores.connected, false);
  assert.equal(app.secrets.size, 0);
  assert.match(app.state().scores.message, /could not be saved/);
});

test('clear waits for a pending secret write and removes the newly written key before finishing', async () => {
  const writing = gate<void>();
  const release = gate<void>();
  const app = await host(async () => [], new Map(), true, {
    input: scoreOptions.input,
    beforeSecretStore: async () => { writing.resolve(); await release.promise; },
  });
  const connecting = app.command('llmBench.connectScores');
  await writing.promise;
  const clearing = app.command('llmBench.clearScores');
  release.resolve();
  await Promise.all([connecting, clearing]);
  assert.equal(app.secrets.size, 0);
  assert.equal(app.state().scores.connected, false);
  assert.equal(app.state().scores.loading, false);
  assert.equal(app.saved.has('scoreCache.v1'), false);
});

test('clearing local models also removes private runtime reference keys while preserving public scores and links', async () => {
  const app = await host(async () => [custom], new Map(), true, scoreOptions);
  await app.command('llmBench.refreshModels');
  await app.command('llmBench.connectScores');
  const catalogKey = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
  await app.editor().send({ type: 'linkScores', key: customScoreKey });
  await app.editor().send({ type: 'linkScores', key: catalogKey });
  const snapshot = app.saved.get('scoreCache.v1');
  await app.command('llmBench.clearLocalModels');
  assert.deepEqual(app.state().scores.links, { [catalogKey]: 'vendor/public-example-1' });
  assert.deepEqual(app.saved.get('scoreLinks.v1'), app.state().scores.links);
  assert.doesNotMatch(JSON.stringify(app.saved.get('scoreLinks.v1')), /organization-model|customendpoint/);
  assert.deepEqual(app.saved.get('scoreCache.v1'), snapshot);
  assert.equal(app.secrets.get('openRouterApiKey'), 'test-openrouter-secret');
  assert.equal(app.state().scores.connected, true);
  assert.equal(app.saved.has('localModels.v1'), false);
});

test('retrying a failed local-model clear removes runtime links even after they were cleared from session state', async () => {
  const app = await host(async () => [custom], new Map(), true, scoreOptions);
  await app.command('llmBench.refreshModels');
  await app.command('llmBench.connectScores');
  await app.editor().send({ type: 'linkScores', key: customScoreKey });
  app.failWrites();
  await app.command('llmBench.clearLocalModels');
  assert.deepEqual(app.state().scores.links, {});
  assert.ok(app.saved.has('scoreLinks.v1'));
  assert.match(app.warnings.at(-1)!, /score references could not be removed/);
  app.failWrites(false);
  await app.command('llmBench.clearLocalModels');
  assert.equal(app.saved.has('scoreLinks.v1'), false);
  assert.equal(app.saved.has('localModels.v1'), false);
  assert.ok(app.saved.has('scoreCache.v1'));
});

test('Show score charts fetches without choosing a reference and preserves explicitly linked references', async () => {
  const calls: string[] = [];
  const app = await host(async () => [custom], new Map(), true, {
    ...scoreOptions, secrets: new Map([['openRouterApiKey', 'test-openrouter-secret']]),
    fetcher: async url => { calls.push(String(url)); return scoreResponse(url); },
  });
  await app.command('llmBench.refreshModels');
  assert.equal(calls.length, 0, 'Opening and discovering do not fetch scores');
  await app.editor().send({ type: 'showScores', key: customScoreKey });
  assert.equal(app.inputs.length, 0);
  assert.equal(app.picks.length, 0);
  assert.equal(app.state().scores.snapshot?.records.length, 2);
  assert.deepEqual(app.state().scores.links, {});
  assert.equal(app.saved.has('scoreLinks.v1'), false);
  await app.editor().send({ type: 'linkScores', key: customScoreKey });
  assert.equal(app.state().scores.links[customScoreKey], 'vendor/public-example-1');
  await app.editor().send({ type: 'showScores', key: customScoreKey });
  assert.equal(calls.length, 4, 'A later Show action fetches fresh scores');
  assert.equal(app.picks.length, 1, 'Existing explicit references are reused');
  assert.ok(calls.every(url => url.startsWith('https://openrouter.ai/api/v1/benchmarks?source=openrouter&benchmark_type=')));
  assert.doesNotMatch(JSON.stringify(app.editor().states), /test-openrouter-secret/);
  assert.doesNotMatch(JSON.stringify([...app.saved.values()]), /test-openrouter-secret/);
});

test('Show score charts without a key connects once and fetches once, and Link also fetches when data is absent', async () => {
  for (const type of ['showScores', 'linkScores']) {
    let calls = 0;
    const app = await host(async () => [], new Map(), true, {
      ...scoreOptions, fetcher: async url => { calls++; return scoreResponse(url); },
    });
    const key = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
    await app.editor().send({ type, key });
    assert.equal(app.inputs.length, 1);
    assert.equal(calls, 2, 'Connecting already downloads; the action must not download twice');
    assert.equal(app.picks.length, type === 'linkScores' ? 1 : 0);
    assert.equal(app.state().scores.links[key], type === 'linkScores' ? 'vendor/public-example-1' : undefined);
  }
});

test('Show score charts uses cached scores after failed refresh and preserves the failure message', async () => {
  let offline = false;
  let calls = 0;
  const app = await host(async () => [], new Map(), true, {
    ...scoreOptions, fetcher: async url => { calls++; if (offline) throw new Error('offline'); return scoreResponse(url); },
  });
  await app.command('llmBench.connectScores');
  const snapshot = app.state().scores.snapshot;
  offline = true;
  const key = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
  await app.editor().send({ type: 'showScores', key });
  assert.equal(calls, 3);
  assert.equal(app.picks.length, 0);
  assert.deepEqual(app.state().scores.snapshot, snapshot);
  assert.deepEqual(app.state().scores.links, {});
  assert.match(app.state().scores.message, /Keeping the previously saved scores/);
});

test('failed or cancelled Show actions without data never open a reference picker', async () => {
  for (const outcome of ['cancel', 'offline', 'empty']) {
    let calls = 0;
    const app = await host(async () => [], new Map(), true, {
      ...scoreOptions, input: async () => outcome === 'cancel' ? undefined : 'test-openrouter-secret',
      fetcher: async () => {
        calls++;
        if (outcome === 'offline') throw new Error('offline');
        return Response.json({ data: [], meta: { as_of: '2026-10-17T00:00:00Z' } });
      },
    });
    const key = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
    await app.editor().send({ type: 'showScores', key });
    assert.equal(app.picks.length, 0);
    assert.equal(app.inputs.length, 1);
    assert.equal(calls, outcome === 'cancel' ? 0 : outcome === 'offline' ? 1 : 2);
    assert.deepEqual(app.state().scores.links, {});
    assert.equal(app.state().scores.loading, false);
    if (outcome === 'offline') assert.match(app.state().scores.message, /could not be refreshed/);
  }
});

test('duplicate Show clicks share the native key prompt and download without asking for references', async () => {
  const entered = gate<string>();
  const prompt = gate<void>();
  let calls = 0;
  const app = await host(async () => [], new Map(), true, {
    ...scoreOptions, input: async () => { prompt.resolve(); return entered.promise; },
    fetcher: async url => { calls++; return scoreResponse(url); },
  });
  const key = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
  const first = app.editor().send({ type: 'showScores', key });
  await prompt.promise;
  const second = app.editor().send({ type: 'showScores', key });
  entered.resolve('test-openrouter-secret');
  await Promise.all([first, second]);
  assert.equal(app.inputs.length, 1);
  assert.equal(calls, 2);
  assert.equal(app.picks.length, 0);
});

test('Show score charts waits for an already running refresh without asking for a reference', async () => {
  const fetching = gate<void>();
  const release = gate<void>();
  let calls = 0;
  const app = await host(async () => [], new Map(), true, {
    ...scoreOptions, secrets: new Map([['openRouterApiKey', 'test-openrouter-secret']]),
    fetcher: async url => { calls++; fetching.resolve(); await release.promise; return scoreResponse(url); },
  });
  const refresh = app.command('llmBench.refreshScores');
  await fetching.promise;
  const key = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
  const showing = app.editor().send({ type: 'showScores', key });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.picks.length, 0);
  release.resolve();
  await Promise.all([refresh, showing]);
  assert.equal(calls, 2);
  assert.equal(app.picks.length, 0);
  assert.deepEqual(app.state().scores.links, {});
});

test('clearing during a Show key prompt or download cannot restore scores or references', async () => {
  for (const phase of ['prompt', 'download']) {
    const started = gate<void>();
    const release = gate<void>();
    const app = await host(async () => [], new Map(), true, {
      ...scoreOptions,
      input: async () => { if (phase === 'prompt') { started.resolve(); await release.promise; } return 'test-openrouter-secret'; },
      fetcher: async url => { if (phase === 'download') { started.resolve(); await release.promise; } return scoreResponse(url); },
    });
    const key = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
    const showing = app.editor().send({ type: 'showScores', key });
    await started.promise;
    await app.command('llmBench.clearScores');
    release.resolve();
    await showing;
    assert.equal(app.secrets.size, 0);
    assert.equal(app.saved.has('scoreCache.v1'), false);
    assert.equal(app.saved.has('scoreLinks.v1'), false);
    assert.equal(app.state().scores.snapshot, undefined);
    assert.deepEqual(app.state().scores.links, {});
    assert.equal(app.picks.length, 0);
  }
});

test('clearing local models or disposing while Show downloads prevents a stale reference picker', async () => {
  for (const action of ['clear-local', 'dispose']) {
    const started = gate<void>();
    const release = gate<void>();
    const app = await host(async () => [custom], new Map(), true, {
      ...scoreOptions, secrets: new Map([['openRouterApiKey', 'test-openrouter-secret']]),
      fetcher: async url => { started.resolve(); await release.promise; return scoreResponse(url); },
    });
    await app.command('llmBench.refreshModels');
    const showing = app.editor().send({ type: 'showScores', key: customScoreKey });
    await started.promise;
    if (action === 'clear-local') {
      await app.command('llmBench.clearLocalModels');
      await app.command('llmBench.refreshModels');
    } else app.dispose();
    release.resolve();
    await showing;
    assert.equal(app.picks.length, 0);
    assert.equal(app.saved.has('scoreLinks.v1'), false);
  }
});

test('clearing in the same turn prevents deferred Show, Compare and Connect actions from starting a prompt or fetch', async () => {
  for (const action of ['show', 'compare', 'connect']) {
    const app = await host(async () => [], new Map(), true, scoreOptions);
    const key = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
    const pending = action === 'show' ? app.editor().send({ type: 'showScores', key })
      : action === 'compare' ? app.editor().send({ type: 'compareScores', keys: [key] }) : app.command('llmBench.connectScores');
    const clearing = app.command('llmBench.clearScores');
    await Promise.all([pending, clearing]);
    assert.equal(app.inputs.length, 0);
    assert.equal(app.picks.length, 0);
    assert.equal(app.secrets.size, 0);
    assert.equal(app.state().scores.snapshot, undefined);
  }
});

test('unlink takes precedence over a pending Show refresh and cannot be undone when that refresh finishes', async () => {
  let waitForRefresh = false;
  const fetching = gate<void>();
  const release = gate<void>();
  const app = await host(async () => [], new Map(), true, {
    ...scoreOptions, fetcher: async url => {
      if (waitForRefresh) { fetching.resolve(); await release.promise; }
      return scoreResponse(url);
    },
  });
  const key = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
  await app.editor().send({ type: 'linkScores', key });
  assert.equal(app.state().scores.links[key], 'vendor/public-example-1');
  waitForRefresh = true;
  const showing = app.editor().send({ type: 'showScores', key });
  await fetching.promise;
  await app.editor().send({ type: 'unlinkScores', key });
  assert.equal(app.state().scores.links[key], undefined);
  release.resolve();
  await showing;
  assert.equal(app.picks.length, 1);
  assert.equal(app.state().scores.links[key], undefined);
  assert.equal((app.saved.get('scoreLinks.v1') as Record<string, string>)[key], undefined);
});

test('Compare downloads once with the saved key without reference prompts and preserves manual references', async () => {
  let calls = 0;
  const app = await host(async () => [custom], new Map(), true, {
    ...scoreOptions, secrets: new Map([['openRouterApiKey', 'test-openrouter-secret']]),
    fetcher: async url => { calls++; return scoreResponse(url); },
  });
  await app.command('llmBench.refreshModels');
  const model = app.state().catalog.models[0];
  const keys = [JSON.stringify(['catalog', model.id]), customScoreKey];
  await app.editor().send({ type: 'compareScores', keys });
  assert.equal(calls, 2, 'One download serves the whole selection');
  assert.equal(app.inputs.length, 0, 'Reuse the configured key');
  assert.equal(app.picks.length, 0);
  assert.equal(app.state().scores.snapshot?.records.length, 2);
  assert.deepEqual(app.state().scores.links, {});
  assert.equal(app.saved.has('scoreLinks.v1'), false);
  await app.editor().send({ type: 'linkScores', key: customScoreKey });
  assert.deepEqual(app.pickOptions.map(settings => (settings as { title: string }).title), [
    `Choose a published reference for ${custom.name}`,
  ]);
  const links = app.state().scores.links;
  await app.editor().send({ type: 'compareScores', keys });
  assert.equal(calls, 4, 'A later comparison refreshes once');
  assert.equal(app.picks.length, 1, 'Only the explicit Link action opened a reference picker');
  assert.deepEqual(app.state().scores.links, links);
  assert.doesNotMatch(JSON.stringify(app.editor().states), /test-openrouter-secret/);
});

test('Compare connects once when needed and never invents saved references', async () => {
  for (const cancel of ['none', 'key']) {
    let calls = 0;
    const app = await host(async () => [], new Map(), true, {
      ...scoreOptions,
      input: async () => cancel === 'key' ? undefined : 'test-openrouter-secret',
      fetcher: async url => { calls++; return scoreResponse(url); },
    });
    const keys = app.state().catalog.models.slice(0, 2).map(model => JSON.stringify(['catalog', model.id]));
    await app.editor().send({ type: 'compareScores', keys });
    assert.equal(app.inputs.length, 1);
    assert.equal(calls, cancel === 'key' ? 0 : 2);
    assert.equal(app.picks.length, 0);
    assert.deepEqual(app.state().scores.links, {});
  }
});

test('rapid additions, View comparison and Show share an in-flight download without reference prompts', async () => {
  const fetching = gate<void>();
  const download = gate<void>();
  let calls = 0;
  const app = await host(async () => [], new Map(), true, {
    ...scoreOptions, secrets: new Map([['openRouterApiKey', 'test-openrouter-secret']]),
    fetcher: async url => { calls++; fetching.resolve(); await download.promise; return scoreResponse(url); },
  });
  const keys = app.state().catalog.models.slice(0, 3).map(model => JSON.stringify(['catalog', model.id]));
  const first = app.editor().send({ type: 'compareScores', keys: keys.slice(0, 1) });
  await fetching.promise;
  const second = app.editor().send({ type: 'compareScores', keys: keys.slice(0, 2) });
  const third = app.editor().send({ type: 'compareScores', keys });
  const view = app.editor().send({ type: 'compareScores', keys });
  const showing = app.editor().send({ type: 'showScores', key: keys[0] });
  await new Promise(resolve => setImmediate(resolve));
  download.resolve();
  await Promise.all([first, second, third, view, showing]);
  assert.equal(calls, 2);
  assert.equal(app.picks.length, 0);
  assert.deepEqual(app.state().scores.links, {});
});

test('only explicit Link actions open reference pickers and concurrent selections are serialized', async () => {
  const picking = gate<void>();
  const release = gate<void>();
  let activePickers = 0;
  const app = await host(async () => [], new Map(), true, {
    ...scoreOptions,
    pick: async items => {
      assert.equal(activePickers++, 0, 'A later explicit Link must not replace the current picker');
      picking.resolve();
      await release.promise;
      activePickers--;
      return items[0];
    },
  });
  const keys = app.state().catalog.models.slice(0, 2).map(model => JSON.stringify(['catalog', model.id]));
  await app.editor().send({ type: 'compareScores', keys });
  assert.equal(app.picks.length, 0);
  const first = app.editor().send({ type: 'linkScores', key: keys[0] });
  await picking.promise;
  const second = app.editor().send({ type: 'linkScores', key: keys[1] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.picks.length, 1);
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(app.picks.length, 2);
  assert.deepEqual(Object.keys(app.state().scores.links), keys);
});

test('Compare rejects unknown or malformed selections before prompting or making requests', async () => {
  const app = await host(async () => [], new Map(), true, scoreOptions);
  const key = JSON.stringify(['catalog', app.state().catalog.models[0].id]);
  for (const keys of [[key, '["catalog","unknown"]'], ['["runtime","unknown"]'], [], [key, key], [key, null]]) {
    await app.editor().send({ type: 'compareScores', keys });
  }
  assert.equal(app.inputs.length, 0);
  assert.equal(app.picks.length, 0);
  assert.equal(app.saved.has('scoreCache.v1'), false);
});

test('Compare preserves cached charts when refreshing fails and does not prompt without any score data', async () => {
  let offline = false;
  const app = await host(async () => [], new Map(), true, {
    ...scoreOptions, fetcher: async url => { if (offline) throw new Error('offline'); return scoreResponse(url); },
  });
  await app.command('llmBench.connectScores');
  const snapshot = app.state().scores.snapshot;
  offline = true;
  const keys = app.state().catalog.models.slice(0, 2).map(model => JSON.stringify(['catalog', model.id]));
  await app.editor().send({ type: 'compareScores', keys });
  assert.deepEqual(app.state().scores.snapshot, snapshot);
  assert.equal(app.picks.length, 0);
  assert.match(app.state().scores.message, /Keeping the previously saved scores/);
  const empty = await host(async () => [], new Map(), true, {
    ...scoreOptions, fetcher: async () => { throw new Error('offline'); },
  });
  await empty.editor().send({ type: 'compareScores', keys });
  assert.equal(empty.picks.length, 0);
  assert.equal(empty.state().scores.snapshot, undefined);
});

test('clearing scores during a comparison key prompt or download invalidates the request', async () => {
  for (const phase of ['prompt', 'download']) {
    const started = gate<void>();
    const release = gate<void>();
    const app = await host(async () => [], new Map(), true, {
      ...scoreOptions, secrets: phase === 'prompt' ? undefined : new Map([['openRouterApiKey', 'test-openrouter-secret']]),
      input: async () => { started.resolve(); await release.promise; return 'test-openrouter-secret'; },
      fetcher: async url => { if (phase === 'download') { started.resolve(); await release.promise; } return scoreResponse(url); },
    });
    const keys = app.state().catalog.models.slice(0, 2).map(model => JSON.stringify(['catalog', model.id]));
    const comparing = app.editor().send({ type: 'compareScores', keys });
    await started.promise;
    await app.command('llmBench.clearScores');
    release.resolve();
    await comparing;
    assert.equal(app.picks.length, 0);
    assert.equal(app.saved.has('scoreLinks.v1'), false);
    assert.equal(app.saved.has('scoreCache.v1'), false);
    assert.equal(app.secrets.size, 0);
    assert.deepEqual(app.state().scores.links, {});
  }
});

test('comparison references cannot outlive unlink, local-model clearing, or extension disposal', async () => {
  for (const action of ['unlink', 'clear-local', 'dispose']) {
    const started = gate<void>();
    const release = gate<void>();
    const app = await host(async () => [custom], new Map(), true, {
      ...scoreOptions, secrets: new Map([['openRouterApiKey', 'test-openrouter-secret']]),
      fetcher: async url => { started.resolve(); await release.promise; return scoreResponse(url); },
    });
    await app.command('llmBench.refreshModels');
    const comparing = app.editor().send({ type: 'compareScores', keys: [customScoreKey] });
    await started.promise;
    if (action === 'unlink') await app.editor().send({ type: 'unlinkScores', key: customScoreKey });
    else if (action === 'clear-local') {
      await app.command('llmBench.clearLocalModels');
      await app.command('llmBench.refreshModels');
    } else app.dispose();
    release.resolve();
    await comparing;
    assert.equal(app.picks.length, 0);
    assert.equal(Object.keys((app.saved.get('scoreLinks.v1') ?? {}) as object).length, 0);
  }
});
