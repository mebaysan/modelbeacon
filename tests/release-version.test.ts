import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/release-version.mts', import.meta.url));

test('release gate compares the whole push, validates package identity, and fails closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'modelbeacon-release-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const manifest = { name: 'modelbeacon', publisher: 'mebaysan', version: '0.4.9' };
  const writeManifest = (value: unknown) => writeFileSync(join(directory, 'package.json'), JSON.stringify(value));
  try {
    git('init');
    git('config', 'user.email', 'release-test@example.invalid');
    git('config', 'user.name', 'Release test');
    writeManifest(manifest);
    git('add', 'package.json');
    git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Before push');
    const before = git('rev-parse', 'HEAD');
    writeManifest({ ...manifest, version: '0.4.10' });
    git('add', 'package.json');
    git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Version bump');
    git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Another commit in the same push');

    function run(version: string, env: Record<string, string> = {}, overrides: Record<string, unknown> = {}, lockVersion = version, rootVersion = version) {
      writeManifest({ ...manifest, version, ...overrides });
      writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ version: lockVersion, packages: { '': { version: rootVersion } } }));
      const output = join(directory, 'outputs');
      writeFileSync(output, '');
      const result = spawnSync(process.execPath, ['--experimental-strip-types', script], {
        cwd: directory, encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_NAME: 'push', BEFORE_SHA: before, GITHUB_OUTPUT: output, ...env },
      });
      return { ...result, output: readFileSync(output, 'utf8') };
    }

    for (const version of ['0.4.10', '0.5.0', '1.0.0']) {
      const result = run(version);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.output, `release=true\ntag=v${version}\n`);
    }
    assert.equal(run('0.4.9', {}, { description: 'Only metadata changed' }).output, 'release=false\ntag=v0.4.9\n');
    assert.equal(run('0.4.10', { GITHUB_EVENT_NAME: 'release', RELEASE_TAG: 'v0.4.10' }).output, 'release=true\ntag=v0.4.10\n');

    const failures = [
      run('0.4.8'), run('0.3.99'), run('0.4.10-beta.1'), run('01.4.10'),
      run('0.4.10', {}, { publisher: 'someone-else' }), run('0.4.10', {}, { name: 'other-extension' }),
      run('0.4.10', {}, {}, '0.4.9'), run('0.4.10', {}, {}, '0.4.10', '0.4.9'),
      run('0.4.10', { BEFORE_SHA: '' }), run('0.4.10', { BEFORE_SHA: '0'.repeat(40) }),
      run('0.4.10', { BEFORE_SHA: 'a'.repeat(40) }), run('0.4.10', { BEFORE_SHA: 'HEAD~1' }),
      run('0.4.10', { GITHUB_EVENT_NAME: 'release', RELEASE_TAG: 'v0.4.9' }),
      run('0.4.10', { GITHUB_EVENT_NAME: 'workflow_dispatch' }),
    ];
    for (const result of failures) {
      assert.notEqual(result.status, 0);
      assert.equal(result.output, '', 'Invalid releases must never produce publish outputs');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
