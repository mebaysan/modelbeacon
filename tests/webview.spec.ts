import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ExplorerState, WebviewRequest } from '../src/types.ts';

declare global {
  interface Window {
    __explorerState: ExplorerState;
    __messages: WebviewRequest[];
    __setExplorerState: (state: ExplorerState) => void;
  }
}

async function explore(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Explore & compare' }).click();
}

async function chooseModels(page: Page, names: string[]): Promise<void> {
  await explore(page);
  for (const name of names) {
    await page.getByRole('searchbox').fill(name);
    await page.getByRole('button', { name: `Add ${name} to comparison`, exact: true }).click();
  }
}

async function exampleBenchmarks(page: Page, names: string[], compatible = true): Promise<void> {
  await page.evaluate(({ names, compatible }) => {
    const state = window.__explorerState;
    state.catalog.sources.push({ id: 'example-evaluation', title: 'Example Evaluation (test fixture)', url: 'https://example.com/evaluation', license: 'Test fixture', licenseUrl: 'https://example.com/license', retrievedAt: '2026-10-17' });
    state.catalog.benchmarks = names.map((name, index) => ({
      id: `example-${index}`, modelId: state.catalog.models.find(model => model.name === name)!.id,
      benchmark: 'Example Evaluation', benchmarkVersion: '1', agent: 'Example agent', agentVersion: compatible ? '1' : String(index + 1),
      reasoningEffort: 'default', accuracy: 60 + index * 5, ci95: 4, trials: 100,
      sourceId: 'example-evaluation', comparisonGroup: compatible ? 'example-compatible-group' : undefined,
    }));
    window.__setExplorerState(state);
  }, { names, compatible });
}

async function exampleScores(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__explorerState;
    // Synthetic chart fixtures, never published observations or live API results.
    state.scores = {
      connected: true, loading: false, message: '', includeComposites: false,
      snapshot: {
        asOf: new Date().toISOString(), fetchedAt: new Date().toISOString(), includesComposites: true,
        records: [
          { modelId: 'fixture/reference-a', modelName: 'Fixture reference A', metric: 'gpqa', value: 0 },
          { modelId: 'fixture/reference-a', modelName: 'Fixture reference A', metric: 'toolUse', value: 63.5, sampleSize: 100 },
          { modelId: 'fixture/reference-a', modelName: 'Fixture reference A', metric: 'intelligence', value: 85.2 },
          { modelId: 'fixture/reference-a', modelName: 'Fixture reference A', metric: 'coding', value: 125.4 },
          { modelId: 'fixture/reference-a', modelName: 'Fixture reference A', metric: 'agentic', value: 72.4 },
          { modelId: 'fixture/reference-b', modelName: 'Fixture reference B', metric: 'gpqa', value: 80.5, standardDeviation: 2.5, sampleSize: 64, evaluatedAt: '2020-01-01', asOf: '2020-01-02', citation: 'Synthetic citation <img src=x onerror=alert(1)>' },
          { modelId: 'fixture/reference-b', modelName: 'Fixture reference B', metric: 'intelligence', value: 88.4 },
        ],
      },
      links: {
        [JSON.stringify(['catalog', 'gpt-5.6-sol'])]: 'fixture/reference-a',
        [JSON.stringify(['catalog', 'gpt-5.6-terra'])]: 'fixture/reference-b',
      },
    };
    window.__setExplorerState(state);
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A clearer choice.' })).toBeVisible();
});

test('shortlists are bounded, source buttons send IDs, and no CSP violations occur', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.reload();
  await expect(page.locator('.recommendation')).toHaveCount(3);
  await page.locator('.recommendation .source-link').first().click();
  expect(await page.evaluate(() => window.__messages.some(message => message.type === 'openSource' && !!message.sourceId))).toBe(true);
  await page.getByRole('button', { name: 'Open Copilot model picker' }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'openPicker' });
  expect(errors).toEqual([]);
});

test('task selection and search persist; tabs support keyboard navigation', async ({ page }) => {
  await page.getByLabel(/Debug & refactor/).check();
  await expect(page.getByRole('heading', { name: 'Options for debug & refactor' })).toBeVisible();
  await page.getByRole('tab', { name: 'Choose for a task' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Explore & compare' })).toBeFocused();
  await page.getByRole('searchbox').fill('GPT-5.6');
  await expect(page.locator('.browse-card')).toHaveCount(3);
  await page.reload();
  await expect(page.getByRole('searchbox')).toHaveValue('GPT-5.6');
  await page.getByRole('tab', { name: 'Explore & compare' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel(/Debug & refactor/)).toBeChecked();
});

test('compatible comparisons show source uncertainty and enforce three-model limit', async ({ page }) => {
  await exampleBenchmarks(page, ['GPT-5.6 Luna', 'GPT-5.6 Sol', 'GPT-5.6 Terra']);
  await chooseModels(page, ['GPT-5.6 Luna', 'GPT-5.6 Sol', 'GPT-5.6 Terra']);
  await expect(page.locator('.benchmark-chart')).toHaveCount(1);
  await expect(page.locator('.benchmark-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.benchmark-chart')).toContainText('95% confidence');
  await expect(page.locator('.benchmark-table')).toContainText('100 trials');
  await expect(page.locator('.benchmark-chart')).toContainText('Example Evaluation');
  await page.getByRole('searchbox').fill('Claude Fable 5');
  await expect(page.getByRole('button', { name: 'Add Claude Fable 5 to comparison', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Clear comparison' }).click();
  await expect(page.locator('.benchmark-chart')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Claude Fable 5 to comparison', exact: true })).toBeEnabled();
});

test('different harnesses remain separate observations without a shared chart', async ({ page }) => {
  await exampleBenchmarks(page, ['Claude Fable 5', 'GPT-6.1 Sol'], false);
  await chooseModels(page, ['Claude Fable 5', 'GPT-6.1 Sol']);
  await expect(page.locator('.benchmark-chart')).toHaveCount(0);
  await expect(page.locator('.benchmark-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.benchmark-section')).toContainText('without a shared ranking');
  await expect(page.locator('.benchmark-section')).toContainText('do not measure your Copilot session');
});

test('bundled catalog compares pricing and capabilities without benchmark placeholders', async ({ page }) => {
  expect(await page.evaluate(() => window.__explorerState.catalog.benchmarks)).toEqual([]);
  await explore(page);
  await expect(page.locator('.evidence-count')).toHaveCount(0);
  await chooseModels(page, ['GPT-5.6 Sol', 'GPT-5.6 Terra']);
  await expect(page.locator('.comparison-table thead th')).toHaveCount(3);
  await expect(page.locator('.comparison-table').getByRole('row', { name: /^Published capabilities/ })).toBeVisible();
  await expect(page.locator('.comparison-table').getByRole('row', { name: /^Everyday coding guidance/ })).toContainText('View source');
  await expect(page.locator('.comparison-table').getByRole('row', { name: /^Published token pricing/ })).toContainText('USD / 1M tokens');
  await expect(page.locator('.benchmark-section')).toHaveCount(0);
  await expect(page.locator('.comparison-section')).not.toContainText('No matching benchmark evidence');
});

test('discovery filters known models and preserves unknown runtime identities as text', async ({ page }) => {
  await page.evaluate(() => {
    const state = window.__explorerState;
    const model = state.catalog.models[0];
    window.__setExplorerState({ ...state, discoveryStatus: 'ready', discovered: [
      { id: model.aliases[0].id, name: model.name, vendor: 'copilot', family: model.id, version: 'preview', maxInputTokens: 100_000 },
      { id: 'unknown', name: '<img src=x onerror=alert(1)>', vendor: 'copilot', family: 'new', version: '1', maxInputTokens: 42_000 },
    ] });
  });
  await explore(page);
  await page.getByRole('button', { name: 'Detected in VS Code', exact: true }).click();
  await expect(page.locator('.browse-card')).toHaveCount(1);
  await expect(page.locator('.unknown-card')).toHaveCount(1);
  await expect(page.locator('.unknown-card')).toContainText('Published capabilities and pricing are unknown');
  await expect(page.locator('.unknown-card .evidence-count')).toHaveCount(0);
  await expect(page.locator('.unknown-card img')).toHaveCount(0);
  await expect(page.locator('.unknown-card')).toContainText('42,000 tokens');
});

test('empty and error discovery retain useful catalog access', async ({ page }) => {
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, discoveryStatus: 'empty', discovered: [] }));
  await expect(page.locator('.recommendation')).toHaveCount(3);
  await explore(page);
  await expect(page.locator('.browse-card')).toHaveCount(31);
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, discoveryStatus: 'error', discoveryMessage: 'Try again.' }));
  await expect(page.getByRole('button', { name: 'Copilot access help' })).toBeVisible();
  await expect(page.locator('.browse-card')).toHaveCount(31);
});

test('expired prices are hidden and stale catalog is labeled', async ({ page }) => {
  await page.evaluate(() => {
    const state = window.__explorerState;
    state.catalog.reviewedAt = '2020-01-01';
    const model = state.catalog.models.find(model => model.name === 'GPT-6.1 Sol')!;
    model.pricing!.validThrough = '2020-01-01';
    window.__setExplorerState(state);
  });
  await expect(page.locator('.catalog-summary')).toContainText('more than 14 days');
  await chooseModels(page, ['GPT-6.1 Sol']);
  await expect(page.locator('.comparison-table')).toContainText('Published price expired');
  await expect(page.locator('.comparison-table .price-tier')).toHaveCount(0);
});

test('disclosures keep their own state and layout stays within the viewport', async ({ page }) => {
  await explore(page);
  await page.locator('.browse-card').first().locator('summary').click();
  await page.locator('.browse-card').first().getByRole('button', { name: /^Add .* to comparison$/ }).click();
  await expect(page.locator('.browse-card details[open]')).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test('custom runtimes compare alongside catalog models without borrowing matching-ID evidence', async ({ page }) => {
  await exampleBenchmarks(page, ['GPT-5.6 Sol']);
  await page.evaluate(() => {
    const state = window.__explorerState;
    const catalog = state.catalog.models.find(model => model.name === 'GPT-5.6 Sol')!;
    const custom = { id: catalog.aliases[0].id, name: catalog.name, vendor: 'private-provider', family: 'custom', version: 'local-v1', maxInputTokens: 48_000 };
    window.__setExplorerState({ ...state, discoveryStatus: 'ready', discovered: [custom], localModels: [{ ...custom, lastSeen: '2026-10-17T10:00:00Z' }] });
  });
  await explore(page);
  await page.getByRole('searchbox').fill('GPT-5.6 Sol');
  await expect(page.locator('.unknown-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add GPT-5.6 Sol to comparison', exact: true }).click();
  await page.getByRole('button', { name: 'Add GPT-5.6 Sol (private-provider, local-v1) to comparison', exact: true }).click();
  const table = page.locator('.comparison-table');
  await expect(table.locator('thead th')).toHaveCount(3);
  await expect(table.getByRole('row', { name: /^Runtime identity/ })).toContainText('private-provider');
  await expect(table.getByRole('row', { name: /^API input limit/ })).toContainText('48,000 tokens');
  await expect(table.getByRole('row', { name: /^Published capabilities/ }).locator('td').last()).toContainText('Unknown');
  await expect(table.getByRole('row', { name: /^Published token pricing/ }).locator('td').last()).toContainText('Unknown');
  await expect(page.locator('.benchmark-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.benchmark-chart')).toHaveCount(0);
  await expect(page.locator('.benchmark-section')).toContainText('private-provider, local-v1): benchmark evidence unknown');
});

test('cached local comparisons rehydrate after reload without claiming current detection', async ({ page }) => {
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, discoveryStatus: 'idle', discovered: [], localModels: [
    { id: 'offline-coder', name: 'Offline coder', vendor: 'local', family: 'coder', version: 'v2', maxInputTokens: 32_000, lastSeen: '2026-10-15T09:00:00Z' },
  ] }));
  await explore(page);
  await page.getByRole('button', { name: 'Add Offline coder (local, v2) to comparison', exact: true }).click();
  await page.reload();
  await expect(page.locator('.unknown-card')).toContainText('Remembered locally');
  await expect(page.locator('.unknown-card')).toContainText('Last reported input limit (cached)');
  await expect(page.locator('.comparison-table')).toContainText('Offline coder');
  await expect(page.locator('.comparison-table')).toContainText('Last reported (cached)');
  await expect(page.locator('.comparison-table')).not.toContainText('Detected in VS Code');
  await expect(page.locator('.comparison-table').getByRole('row', { name: /^Last seen/ })).toContainText('2026');
  await page.getByRole('button', { name: 'Detected in VS Code', exact: true }).click();
  await expect(page.locator('.unknown-card')).toHaveCount(0);
  await expect(page.locator('.browse-card')).toHaveCount(0);
  await expect(page.locator('.comparison-table')).toContainText('Remembered locally');
});

test('runtime identity includes vendor and version, and current reports replace duplicate cached metadata', async ({ page }) => {
  await page.evaluate(() => {
    const shared = { id: 'same-id', name: 'Private coder', family: 'coder', maxInputTokens: 32_000, lastSeen: '2026-10-15T09:00:00Z' };
    const localModels = [
      { ...shared, vendor: 'provider-a', version: 'v1' },
      { ...shared, vendor: 'provider-b', version: 'v1' },
      { ...shared, vendor: 'provider-a', version: 'v2' },
    ];
    window.__setExplorerState({ ...window.__explorerState, discoveryStatus: 'ready', localModels, discovered: [{ ...localModels[0], maxInputTokens: 64_000 }] });
  });
  await explore(page);
  await expect(page.locator('.unknown-card')).toHaveCount(3);
  await expect(page.locator('.unknown-card').filter({ hasText: 'Detected in VS Code' })).toHaveCount(1);
  for (const identity of ['provider-a, v1', 'provider-b, v1', 'provider-a, v2']) {
    await page.getByRole('button', { name: `Add Private coder (${identity}) to comparison`, exact: true }).click();
  }
  await expect(page.locator('.comparison-table thead th')).toHaveCount(4);
  const limits = page.locator('.comparison-table').getByRole('row', { name: /^API input limit/ });
  await expect(limits.locator('td').first()).toContainText('64,000 tokens');
  await expect(limits.locator('td').nth(1)).toContainText('32,000 tokens');
  await expect(limits.locator('td').nth(1)).toContainText('cached');
  await expect(page.locator('.benchmark-table')).toHaveCount(0);
  await expect(page.locator('.benchmark-chart')).toHaveCount(0);
  await expect(page.locator('.browse-card').first().getByRole('button', { name: /^Add .* to comparison$/ })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test('clearing local models removes runtime selections from saved view state and keeps catalog selections', async ({ page }) => {
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, localModels: [
    { id: 'clear-me', name: 'Temporary coder', vendor: 'private', family: 'coder', version: 'v1', maxInputTokens: 16_000, lastSeen: '2026-10-15T09:00:00Z' },
  ] }));
  await explore(page);
  await page.getByRole('button', { name: 'Add GPT-5.6 Sol to comparison', exact: true }).click();
  await page.getByRole('button', { name: 'Add Temporary coder (private, v1) to comparison', exact: true }).click();
  await page.getByRole('button', { name: 'Clear local models', exact: true }).click();
  await expect(page.locator('.unknown-card')).toHaveCount(0);
  await expect(page.locator('.comparison-table')).not.toContainText('Temporary coder');
  await expect(page.locator('.comparison-table')).toContainText('GPT-5.6 Sol');
  expect(await page.evaluate(() => window.__messages.some(message => message.type === 'clearLocalModels'))).toBe(true);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('explorer')!).selected)).toEqual([JSON.stringify(['catalog', 'gpt-5.6-sol'])]);
  await page.reload();
  await expect(page.locator('.unknown-card')).toHaveCount(0);
  await expect(page.locator('.comparison-table thead th')).toHaveCount(2);
  expect(await page.evaluate(() => window.__explorerState.localModels)).toEqual([]);
});

test('clear remains available during first detection and after a cache-clear failure', async ({ page }) => {
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, discoveryStatus: 'loading', localModels: [], discovered: [] }));
  await expect(page.getByRole('button', { name: 'Clear local models', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Clear local models', exact: true }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'clearLocalModels' });
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, discoveryStatus: 'idle', localModelsMessage: 'Could not clear saved metadata. Try again.' }));
  await expect(page.getByRole('button', { name: 'Clear local models', exact: true })).toBeEnabled();
  await expect(page.locator('.discovery-status')).toContainText('Could not clear saved metadata');
});

test('home availability filter excludes cached models, includes custom models, and is shared with explore', async ({ page }) => {
  await page.evaluate(() => {
    const state = window.__explorerState;
    const model = state.catalog.models.find(model => model.guidance.some(guidance => guidance.task === 'everyday') && model.aliases.length)!;
    window.__setExplorerState({ ...state, discoveryStatus: 'ready', discovered: [
      { id: model.aliases[0].id, name: model.name, vendor: 'copilot', family: model.id, version: model.aliases[0].version || 'preview', maxInputTokens: 100_000 },
      { id: 'available-custom', name: 'Available custom coder', vendor: 'local', family: 'custom', version: '1', maxInputTokens: 32_000 },
    ], localModels: [
      { id: 'cached-only', name: 'Cached-only coder', vendor: 'local', family: 'custom', version: '1', maxInputTokens: 16_000, lastSeen: '2026-10-15T09:00:00Z' },
    ] });
  });
  await page.getByRole('checkbox', { name: 'Available models only', exact: true }).check();
  await expect(page.locator('.recommendation')).toHaveCount(1);
  await expect(page.locator('.other-available-models .unknown-card')).toHaveCount(1);
  await expect(page.locator('.other-available-models')).toContainText('Available custom coder');
  await expect(page.locator('#choose-panel')).not.toContainText('Cached-only coder');
  await expect(page.locator('.other-available-models .unknown-card')).toContainText('Published capabilities and pricing are unknown');
  await explore(page);
  await expect(page.getByRole('button', { name: 'Detected in VS Code', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.browse-card')).toHaveCount(1);
  await expect(page.locator('.unknown-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Public catalog + local', exact: true }).click();
  await page.getByRole('tab', { name: 'Choose for a task' }).click();
  await expect(page.getByRole('checkbox', { name: 'Available models only', exact: true })).not.toBeChecked();
  await expect(page.locator('.recommendation')).toHaveCount(3);
  await page.getByRole('checkbox', { name: 'Available models only', exact: true }).check();
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, discovered: window.__explorerState.discovered.filter(model => model.vendor === 'local') }));
  await expect(page.locator('.recommendation')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No supported shortlist for this selection' })).toBeVisible();
  await expect(page.locator('.other-available-models')).toContainText('Available custom coder');
  await page.getByRole('button', { name: 'Add Available custom coder (local, 1) to comparison', exact: true }).click();
  await expect(page.locator('.compare-tray')).toContainText('Available custom coder');
});

test('checking availability requests idle/error detection and persists without using cache as availability', async ({ page }) => {
  const filter = page.getByRole('checkbox', { name: 'Available models only', exact: true });
  await filter.check();
  expect(await page.evaluate(() => window.__messages.filter(message => message.type === 'detectModels').length)).toBe(1);
  await expect(filter).toBeChecked();
  await page.reload();
  await expect(filter).toBeChecked();
  await expect(page.locator('.recommendation')).toHaveCount(0);
  await expect(page.locator('.other-available-models')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No available models detected' })).toBeVisible();
  await filter.uncheck();
  await expect(page.locator('.recommendation')).toHaveCount(3);
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, discoveryStatus: 'error', discovered: [] }));
  await filter.check();
  expect(await page.evaluate(() => window.__messages.filter(message => message.type === 'detectModels').length)).toBe(1);
  await expect(filter).toBeChecked();
});

test('availability filter never falls back to public recommendations for empty, failed or pending detection', async ({ page }) => {
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, discoveryStatus: 'ready', discovered: [] }));
  const filter = page.getByRole('checkbox', { name: 'Available models only', exact: true });
  await filter.check();
  for (const discoveryStatus of ['empty', 'error', 'loading'] as const) {
    await page.evaluate(status => window.__setExplorerState({ ...window.__explorerState, discoveryStatus: status, discovered: [] }), discoveryStatus);
    await expect(filter).toBeChecked();
    await expect(page.locator('.recommendation')).toHaveCount(0);
    await expect(page.locator('.other-available-models')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No available models detected' })).toBeVisible();
  }
  await filter.uncheck();
  await expect(page.locator('.recommendation')).toHaveCount(3);
});

test('score controls use host actions without putting a key in the webview', async ({ page }) => {
  const status = page.getByRole('region', { name: 'Published score connection' });
  await expect(status).toContainText('No score snapshot saved');
  await expect(status).toContainText('Terminal-Bench');
  await expect(status.getByRole('checkbox', { name: 'Include composite indexes' })).not.toBeChecked();
  await status.getByRole('button', { name: 'Connect OpenRouter', exact: true }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'connectScores' });
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await exampleScores(page);
  await expect(status).not.toContainText('over 14 days old');
  await status.getByRole('button', { name: 'Refresh scores', exact: true }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'refreshScores' });
  await explore(page);
  await expect(status.getByRole('button', { name: 'Disconnect & clear scores', exact: true })).toBeVisible();
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, loading: true } }));
  await expect(status.getByRole('button', { name: 'Refreshing scores…', exact: true })).toBeDisabled();
  await expect(status.getByRole('checkbox', { name: 'Include composite indexes' })).toBeDisabled();
  await status.getByRole('button', { name: 'Disconnect & clear scores', exact: true }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'clearScores' });
});

test('score charts compare each metric independently and distinguish missing values from zero', async ({ page }) => {
  await exampleScores(page);
  await chooseModels(page, ['GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna']);
  const evidence = page.locator('.comparison-section > .score-evidence');
  await expect(evidence.locator('.score-chart')).toHaveCount(2);
  const gpqa = evidence.locator('[data-metric="gpqa"]');
  await expect(gpqa.locator('.score-chart-row')).toHaveCount(3);
  await expect(gpqa.locator('.score-number')).toHaveText(['0.0%', '80.5%', 'Unavailable']);
  await expect(gpqa.locator('.score-zero')).toHaveCount(1);
  await expect(gpqa.locator('.score-bar')).toHaveCount(2);
  await expect(gpqa.locator('.score-bar').first()).toHaveAttribute('width', '0');
  await expect(gpqa.locator('.score-missing')).toHaveCount(1);
  await expect(gpqa).toContainText('SD ±2.5 percentage points');
  await expect(gpqa).toContainText('n = 64');
  await expect(gpqa).toContainText('Source data over 14 days old');
  await expect(gpqa.locator('.score-chart-row').first()).not.toContainText('over 14 days old');
  await expect(gpqa).toContainText('Synthetic citation <img src=x onerror=alert(1)>');
  await expect(gpqa.locator('img')).toHaveCount(0);
  await expect(gpqa).toContainText('not a confidence interval');
  await expect(gpqa.locator('.score-axis')).toHaveText('0255075100');
  await expect(gpqa.locator('.score-chart-row svg').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(evidence.locator('[data-metric="toolUse"] .score-number')).toHaveText(['63.5%', 'Unavailable', 'Unavailable']);
  await expect(evidence).toContainText('not verified model matches');
  await expect(evidence).toContainText('Source data as of');
  await gpqa.getByRole('button', { name: /methodology/ }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'openScoreSource', metric: 'gpqa' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test('composite policy hides cached indexes until explicitly enabled', async ({ page }) => {
  await exampleScores(page);
  await chooseModels(page, ['GPT-5.6 Sol', 'GPT-5.6 Terra']);
  const evidence = page.locator('.comparison-section > .score-evidence');
  await expect(evidence.locator('[data-metric="intelligence"]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Include composite indexes' }).check();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'setCompositeScores', enabled: true });
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, includeComposites: true } }));
  await expect(evidence.locator('.score-chart')).toHaveCount(5);
  await expect(evidence.locator('[data-metric="intelligence"] .score-number')).toHaveText(['85.2 pts', '88.4 pts']);
  await expect(evidence.locator('[data-metric="agentic"]')).toContainText('Index points');
  await expect(evidence.locator('[data-metric="agentic"]')).not.toContainText('Accuracy');
  await expect(evidence.locator('[data-metric="coding"] .score-number').first()).toHaveText('125.4 pts');
  await expect(evidence.locator('[data-metric="coding"] .score-axis')).toHaveText('032.56597.5130');
  expect(Number(await evidence.locator('[data-metric="coding"] .score-bar').getAttribute('width'))).toBeLessThan(300);
  await page.evaluate(() => {
    const state = window.__explorerState;
    state.scores.snapshot!.records.find(record => record.metric === 'coding')!.value = Number.MAX_VALUE;
    window.__setExplorerState(state);
  });
  await expect(evidence.locator('[data-metric="coding"] .score-bar')).toHaveAttribute('width', '300');
  await expect(evidence.locator('[data-metric="coding"] .score-axis')).not.toContainText('Infinity');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, includeComposites: false } }));
  await expect(evidence.locator('.score-chart')).toHaveCount(2);
  await expect(evidence).not.toContainText('85.2');
});

test('custom score references never inherit from a shared name or another provider', async ({ page }) => {
  await exampleScores(page);
  await page.evaluate(() => {
    const shared = { id: 'private-coder', name: 'GPT-5.6 Sol', family: 'private', version: 'v1', maxInputTokens: 32_000 };
    window.__setExplorerState({ ...window.__explorerState, discoveryStatus: 'ready', discovered: [{ ...shared, vendor: 'organization-a' }, { ...shared, vendor: 'organization-b' }] });
  });
  await chooseModels(page, ['GPT-5.6 Sol']);
  for (const vendor of ['organization-a', 'organization-b']) await page.getByRole('button', { name: `Add GPT-5.6 Sol (${vendor}, v1) to comparison`, exact: true }).click();
  const evidence = page.locator('.comparison-section > .score-evidence');
  await expect(evidence.locator('[data-metric="gpqa"] .score-number')).toHaveText(['0.0%', 'Unavailable', 'Unavailable']);
  const key = JSON.stringify(['runtime', `runtime:${JSON.stringify(['organization-a', 'private-coder', 'v1'])}`]);
  await page.locator('.score-reference-grid').getByRole('button', { name: 'Link score reference for GPT-5.6 Sol (organization-a, v1)', exact: true }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'linkScores', key });
  await page.evaluate(key => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, links: { ...window.__explorerState.scores.links, [key]: 'fixture/reference-b' } } }), key);
  await expect(evidence.locator('[data-metric="gpqa"] .score-number')).toHaveText(['0.0%', '80.5%', 'Unavailable']);
  const custom = page.locator('.unknown-card').filter({ hasText: 'organization-a' });
  await custom.locator('summary').click();
  await expect(custom.locator('[data-metric="gpqa"] .score-number')).toHaveText('80.5%');
  await expect(custom).toContainText('Fixture reference B');
  await custom.getByRole('button', { name: 'Unlink score reference for GPT-5.6 Sol (organization-a, v1)', exact: true }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'unlinkScores', key });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test('model details retain sourced charts when refresh fails and clearly date the saved snapshot', async ({ page }) => {
  await exampleScores(page);
  await page.evaluate(() => {
    const state = window.__explorerState;
    state.scores.message = 'Refresh failed. Saved scores remain available.';
    state.scores.snapshot!.fetchedAt = '2020-01-01T00:00:00Z';
    window.__setExplorerState(state);
  });
  await explore(page);
  await page.getByRole('searchbox').fill('GPT-5.6 Sol');
  const card = page.locator('.browse-card');
  await card.locator('summary').click();
  await expect(card.locator('.compact-score-chart')).toHaveCount(2);
  await expect(card.locator('[data-metric="gpqa"] .score-number')).toHaveText('0.0%');
  await expect(card).toContainText('Snapshot over 14 days old');
  await expect(page.locator('.score-status')).toContainText('Refresh failed. Saved scores remain available.');
  await expect(page.locator('.score-status')).toContainText('over 14 days old');
  await card.getByRole('button', { name: 'Change score reference for GPT-5.6 Sol', exact: true }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'linkScores', key: JSON.stringify(['catalog', 'gpt-5.6-sol']) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test('score chart actions load from a cold start without a separate refresh or connection step', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^Show score charts for / })).toHaveCount(3);
  const modelName = await page.locator('.recommendation .model-title').first().innerText();
  const key = await page.evaluate(name => JSON.stringify(['catalog', window.__explorerState.catalog.models.find(model => model.name === name)!.id]), modelName);
  await page.evaluate(() => { window.__messages = []; });
  await page.getByRole('button', { name: `Show score charts for ${modelName}`, exact: true }).click();
  expect(await page.evaluate(() => window.__messages)).toEqual([{ type: 'showScores', key }]);
  const card = page.locator('.browse-card').filter({ has: page.getByRole('heading', { name: modelName, exact: true }) });
  await expect(card.locator('details')).toHaveAttribute('open', '');
  await expect(card.getByRole('button', { name: `Link score reference for ${modelName}`, exact: true })).toBeEnabled();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('.score-status')).toContainText('Preview only');
  await expect(card.locator('.score-feedback')).toContainText('Preview only');
  await card.getByRole('button', { name: `Link score reference for ${modelName}`, exact: true }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'linkScores', key });
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, message: 'Score loading cancelled. Choose Show score charts to try again.' } }));
  await expect(card.locator('.score-feedback')).toHaveText('Score loading cancelled. Choose Show score charts to try again.');
  await expect(card.getByRole('button', { name: `Show score charts for ${modelName}`, exact: true })).toBeEnabled();
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, loading: true } }));
  await expect(card.locator('.score-loading')).toBeVisible();
  await expect(card.getByRole('button', { name: `Show score charts for ${modelName}`, exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: `Show score charts for ${modelName}`, exact: true })).toHaveText('Loading scores…');
  await expect(card.getByRole('button', { name: `Link score reference for ${modelName}`, exact: true })).toBeDisabled();
  await exampleScores(page);
  await page.evaluate(key => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, links: { [key]: 'fixture/reference-a' } } }), key);
  await expect(card.locator('details')).toHaveAttribute('open', '');
  await expect(card.locator('[data-metric="gpqa"]')).toBeVisible();
});

test('saved score chart actions reveal details and request fresh scores even when already linked', async ({ page }) => {
  await exampleScores(page);
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, links: {} } }));
  const status = page.getByRole('region', { name: 'Published score connection' });
  await expect(status).toContainText('3 saved scores · 2 public references');
  await expect(status).toContainText('No models linked to these scores yet');
  await expect(status).toContainText('automatically refresh scores');
  await explore(page);
  await page.getByRole('searchbox').fill('An unrelated search');
  await page.getByRole('tab', { name: 'Choose for a task' }).click();
  const modelName = await page.locator('.recommendation .model-title').first().innerText();
  const key = await page.evaluate(name => JSON.stringify(['catalog', window.__explorerState.catalog.models.find(model => model.name === name)!.id]), modelName);
  await page.evaluate(() => { window.__messages = []; });
  await page.getByRole('button', { name: `Show score charts for ${modelName}`, exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Explore & compare' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  expect(await page.evaluate(() => window.__messages)).toEqual([{ type: 'showScores', key }]);
  const card = page.locator('.browse-card').filter({ has: page.getByRole('heading', { name: modelName, exact: true }) });
  await expect(card.locator('details')).toHaveAttribute('open', '');
  await page.evaluate(key => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, links: { [key]: 'fixture/reference-a' } } }), key);
  await expect(card.locator('[data-metric="gpqa"]')).toBeVisible();
  await expect(card.locator('[data-metric="gpqa"] .score-number')).toHaveText('0.0%');
  await card.locator('summary').click();
  await page.evaluate(() => { window.__messages = []; });
  await card.getByRole('button', { name: `Show score charts for ${modelName}`, exact: true }).click();
  await expect(card.locator('[data-metric="gpqa"]')).toBeVisible();
  expect(await page.evaluate(() => window.__messages)).toEqual([{ type: 'showScores', key }]);
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, loading: true } }));
  await expect(card.getByRole('button', { name: `Show score charts for ${modelName}`, exact: true })).toBeDisabled();
  await expect(card.locator('[data-metric="gpqa"]')).toBeVisible();
  await expect(card.getByRole('button', { name: `Unlink score reference for ${modelName}`, exact: true })).toBeDisabled();
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, loading: false, message: 'Score refresh failed. Saved scores are still available.' } }));
  await expect(card.getByRole('button', { name: `Unlink score reference for ${modelName}`, exact: true })).toBeEnabled();
  await expect(card.locator('.score-feedback')).toHaveText('Score refresh failed. Saved scores are still available.');
  await expect(card.locator('[data-metric="gpqa"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test('custom score chart action preserves availability and uses the exact runtime identity', async ({ page }) => {
  await exampleScores(page);
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, links: {} }, discoveryStatus: 'ready', discovered: [
    { id: 'private-coder', name: 'Private coder', vendor: 'organization', family: 'private', version: 'v2', maxInputTokens: 32_000 },
  ] }));
  await page.getByRole('checkbox', { name: 'Available models only', exact: true }).check();
  await page.evaluate(() => { window.__messages = []; });
  await page.getByRole('button', { name: 'Show score charts for Private coder (organization, v2)', exact: true }).click();
  const key = JSON.stringify(['runtime', `runtime:${JSON.stringify(['organization', 'private-coder', 'v2'])}`]);
  expect(await page.evaluate(() => window.__messages)).toEqual([{ type: 'showScores', key }]);
  await expect(page.getByRole('button', { name: 'Detected in VS Code', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const card = page.locator('.unknown-card');
  await expect(card.locator('details')).toHaveAttribute('open', '');
  await page.evaluate(key => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, links: { [key]: 'fixture/reference-b' } } }), key);
  await expect(card.locator('[data-metric="gpqa"]')).toBeVisible();
  await expect(card.locator('[data-metric="gpqa"] .score-number')).toHaveText('80.5%');
  await expect(page.locator('.comparison-section')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test('score actions and cache counts honor the selected metric policy', async ({ page }) => {
  await exampleScores(page);
  await page.evaluate(() => {
    const state = window.__explorerState;
    state.scores.snapshot!.records = state.scores.snapshot!.records.filter(record => !['gpqa', 'toolUse'].includes(record.metric));
    window.__setExplorerState(state);
  });
  const status = page.getByRole('region', { name: 'Published score connection' });
  await expect(status).toContainText('0 saved scores · 0 public references');
  await expect(status).toContainText('No saved scores match the current metric selection');
  await expect(page.getByRole('button', { name: /^Show score charts for / })).toHaveCount(3);
  await explore(page);
  await page.getByRole('searchbox').fill('GPT-5.6 Sol');
  await page.locator('.browse-card summary').click();
  await expect(page.locator('.browse-card').getByRole('button', { name: 'Change score reference for GPT-5.6 Sol', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Show score charts for GPT-5.6 Sol', exact: true }).click();
  expect(await page.evaluate(() => window.__messages.at(-1))).toEqual({ type: 'showScores', key: JSON.stringify(['catalog', 'gpt-5.6-sol']) });
  await page.evaluate(() => window.__setExplorerState({ ...window.__explorerState, scores: { ...window.__explorerState.scores, includeComposites: true } }));
  await expect(status).toContainText('4 saved scores · 2 public references');
  await expect(page.getByRole('button', { name: 'Show score charts for GPT-5.6 Sol', exact: true })).toBeEnabled();
});
