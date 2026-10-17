import assert from 'node:assert/strict';
import * as vscode from 'vscode';

function explorerTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
    tab.input instanceof vscode.TabInputWebview && tab.label === 'ModelBeacon');
}

async function waitForTabs(count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (explorerTabs().length !== count && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(explorerTabs().length, count, `Expected ${count} explorer editor tabs`);
}

export async function run(): Promise<void> {
  assert.equal(process.env.LLMBENCH_EXTENSION_SMOKE, '1', 'Run through scripts/test-extension.mjs with an isolated profile');
  assert.equal(vscode.workspace.getConfiguration('llmBench').get('autoUpdateCatalog'), false, 'Smoke tests must not fetch the live catalog');
  const extension = vscode.extensions.getExtension('mebaysan.modelbeacon');
  assert.ok(extension, 'Development extension must be installed');
  const manifest = extension.packageJSON;
  assert.equal(manifest.publisher, 'mebaysan');
  assert.equal(manifest.displayName, 'ModelBeacon');
  assert.equal(manifest.homepage, 'https://mebaysan.com');
  assert.equal(manifest.author.url, 'https://mebaysan.com');
  assert.equal(manifest.contributes.configuration.properties['llmBench.includeCompositeScores'].default, false);
  const container = manifest.contributes.viewsContainers.activitybar.find((value: { id: string }) => value.id === 'llmBench');
  assert.ok(container, 'Activity Bar container must be declared');
  assert.equal(container.title, 'ModelBeacon');
  const icon = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extension.extensionUri, container.icon));
  assert.match(Buffer.from(icon).toString('utf8'), /<svg\b/);
  assert.ok(manifest.contributes.views.llmBench.some((view: { id: string; type: string }) => view.id === 'llmBench.home' && view.type === 'webview'));
  await extension.activate();
  assert.equal(extension.isActive, true, 'Extension must activate successfully with its bundled catalog');

  const commands = await vscode.commands.getCommands(true);
  for (const command of ['llmBench.open', 'llmBench.refreshModels', 'llmBench.refreshCatalog', 'llmBench.clearLocalModels',
    'llmBench.connectScores', 'llmBench.refreshScores', 'llmBench.clearScores']) {
    assert.ok(commands.includes(command), `Missing command: ${command}`);
  }
  await vscode.commands.executeCommand('llmBench.clearLocalModels');
  assert.equal(explorerTabs().length, 0);
  await vscode.commands.executeCommand('workbench.view.extension.llmBench');
  await vscode.commands.executeCommand('llmBench.home.focus');
  assert.equal(explorerTabs().length, 0, 'Opening the Activity Bar homepage must not open an editor tab');
  await vscode.commands.executeCommand('llmBench.open');
  await waitForTabs(1);
  assert.equal(explorerTabs()[0].isActive, true, 'Explorer must open in the active editor');

  await vscode.commands.executeCommand('llmBench.open');
  await waitForTabs(1);
  assert.equal(explorerTabs()[0].isActive, true, 'Opening again must reveal the existing panel');

  assert.equal(await vscode.window.tabGroups.close(explorerTabs()), true);
  await waitForTabs(0);
  await vscode.commands.executeCommand('llmBench.open');
  await waitForTabs(1);
  assert.equal(await vscode.window.tabGroups.close(explorerTabs()), true);
  await waitForTabs(0);
  console.log(`ModelBeacon smoke passed on VS Code ${vscode.version}: branding, Activity Bar homepage, commands, singleton editor and panel lifecycle.`);
}
