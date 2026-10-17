import { build } from 'esbuild';
import { runTests } from '@vscode/test-electron';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDirectory = path.join(root, '.vscode-test');
const testEntry = path.join(testDirectory, 'extension-smoke.cjs');
await mkdir(testDirectory, { recursive: true });
await build({
  entryPoints: [path.join(root, 'tests/extension-smoke.ts')], outfile: testEntry,
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'],
});

// Keep the Unix IPC socket path below macOS's 103-character limit.
const profile = await mkdtemp(path.join(testDirectory, 'p-'));
const userData = path.join(profile, 'u');
const extensions = path.join(profile, 'e');
await mkdir(path.join(userData, 'User'), { recursive: true });
await mkdir(extensions, { recursive: true });
await writeFile(path.join(userData, 'User', 'settings.json'), JSON.stringify({
  'llmBench.autoUpdateCatalog': false,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'extensions.ignoreRecommendations': true,
  'security.workspace.trust.enabled': false,
  'workbench.startupEditor': 'none',
  'workbench.enableExperiments': false,
  'chat.disableAIFeatures': true,
}));

try {
  await runTests({
    version: process.env.VSCODE_VERSION || '1.140.0',
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || undefined,
    extensionDevelopmentPath: root,
    extensionTestsPath: testEntry,
    reuseMachineInstall: false,
    extensionTestsEnv: { LLMBENCH_EXTENSION_SMOKE: '1' },
    launchArgs: [
      `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, '--disable-extensions',
      '--disable-telemetry', '--disable-updates', '--skip-welcome', '--skip-release-notes',
      '--disable-workspace-trust', '--new-window',
    ],
  });
  await rm(profile, { recursive: true, force: true });
} catch (error) {
  console.error(`Extension smoke test failed. Isolated profile and logs retained at ${profile}`);
  throw error;
}
