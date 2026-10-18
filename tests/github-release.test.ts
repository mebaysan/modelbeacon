import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { publishGitHubRelease } from '../scripts/github-release.mts';

const sha = 'a'.repeat(40);
const tag = 'v0.4.5';
const repository = 'mebaysan/modelbeacon';
const manifest = { name: 'modelbeacon', publisher: 'mebaysan', version: '0.4.5' };
const existing = { tag_name: tag, prerelease: false, draft: false, assets: [{ name: 'modelbeacon.vsix', state: 'uploaded' }] };

function fixture(options: { refs?: string; release?: unknown; listedReleases?: unknown[]; lookupError?: Error; downloadedManifest?: unknown; localManifest?: unknown; failUpload?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'modelbeacon-release-'));
  const artifact = join(directory, 'modelbeacon.vsix');
  writeFileSync(artifact, 'fresh VSIX');
  const calls: { file: string; args: string[] }[] = [];
  function run(file: string, args: string[]) {
    calls.push({ file, args });
    if (file === 'unzip') return JSON.stringify(args[1] === artifact ? options.localManifest ?? manifest : options.downloadedManifest ?? manifest);
    if (file === 'git') return options.refs ?? `${sha}\trefs/tags/${tag}\n`;
    assert.equal(file, 'gh');
    if (args[0] === 'api') {
      if (args.includes('--paginate')) return (options.listedReleases ?? []).map(item => JSON.stringify(item)).join('\n');
      if (options.lookupError) throw options.lookupError;
      if (options.release !== undefined) return JSON.stringify(options.release);
      throw Object.assign(new Error('missing release'), { stderr: 'gh: Not Found (HTTP 404)' });
    }
    if (args[1] === 'download') writeFileSync(join(args[args.indexOf('--dir') + 1], 'modelbeacon.vsix'), 'published VSIX');
    if (args[1] === 'upload' && options.failUpload) throw new Error('immutable release');
    return '';
  }
  return { artifact, calls, directory, run, publish: () => publishGitHubRelease({ tag, sha, repository, artifact }, run), clean: () => rmSync(directory, { recursive: true, force: true }) };
}

test('creates a release at the checked commit with its validated VSIX attached', () => {
  const f = fixture({ refs: '' });
  try {
    f.publish();
    assert.deepEqual(f.calls.at(-1), { file: 'gh', args: ['release', 'create', tag, f.artifact, '--repo', repository, '--target', sha, '--generate-notes'] });
    assert.equal(readFileSync(f.artifact, 'utf8'), 'fresh VSIX');
  } finally { f.clean(); }
});

test('rejects both lightweight and annotated tags pointing to a different commit before release mutation', () => {
  for (const refs of [`${'b'.repeat(40)}\trefs/tags/${tag}\n`, `${sha}\trefs/tags/${tag}\n${'b'.repeat(40)}\trefs/tags/${tag}^{}\n`]) {
    const f = fixture({ refs });
    try {
      assert.throws(f.publish, /different commit/);
      assert.ok(f.calls.every(call => call.file !== 'gh'));
    } finally { f.clean(); }
  }
});

test('accepts a matching annotated tag and reuses validated published bytes on retries', () => {
  const f = fixture({ refs: `${'b'.repeat(40)}\trefs/tags/${tag}\n${sha}\trefs/tags/${tag}^{}\n`, release: existing });
  try {
    f.publish();
    assert.equal(readFileSync(f.artifact, 'utf8'), 'published VSIX');
    assert.ok(f.calls.some(call => call.args[1] === 'download'));
    assert.ok(f.calls.every(call => !['create', 'upload', 'edit'].includes(call.args[1])));
    assert.deepEqual(readdirSync(f.directory), ['modelbeacon.vsix']);
  } finally { f.clean(); }
});

test('rejects invalid downloaded identity without replacing local bytes or leaking temporary files', () => {
  for (const downloadedManifest of [{ ...manifest, publisher: 'other' }, { ...manifest, name: 'other' }, { ...manifest, version: '0.4.6' }]) {
    const f = fixture({ release: existing, downloadedManifest });
    try {
      assert.throws(f.publish, /does not match/);
      assert.equal(readFileSync(f.artifact, 'utf8'), 'fresh VSIX');
      assert.deepEqual(readdirSync(f.directory), ['modelbeacon.vsix']);
    } finally { f.clean(); }
  }
});

test('resumes a partial draft by uploading its missing asset before publishing', () => {
  const f = fixture({ release: { ...existing, draft: true, assets: [] } });
  try {
    f.publish();
    assert.deepEqual(f.calls.slice(-2), [
      { file: 'gh', args: ['release', 'upload', tag, f.artifact, '--repo', repository] },
      { file: 'gh', args: ['release', 'edit', tag, '--repo', repository, '--draft=false'] },
    ]);
  } finally { f.clean(); }
});

test('resumes a draft with an existing asset only after validating and reusing it', () => {
  const f = fixture({ release: { ...existing, draft: true } });
  try {
    f.publish();
    assert.equal(readFileSync(f.artifact, 'utf8'), 'published VSIX');
    assert.equal(f.calls.at(-1)?.args[1], 'edit');
    assert.ok(f.calls.every(call => call.args[1] !== 'upload'));
  } finally { f.clean(); }
});

test('resumes an unpublished draft without a tag only when its target is the exact checked commit', () => {
  for (const target_commitish of [sha, 'main']) {
    const f = fixture({ refs: '', listedReleases: [{ ...existing, draft: true, target_commitish }] });
    try {
      if (target_commitish === sha) {
        f.publish();
        assert.ok(f.calls.some(call => call.args.includes('--paginate')));
        assert.equal(f.calls.at(-1)?.args[1], 'edit');
      } else {
        assert.throws(f.publish, /exact draft commit/);
        assert.ok(f.calls.every(call => call.args[0] !== 'release'));
      }
    } finally { f.clean(); }
  }
});

test('does not treat authorization or network failures as missing releases', () => {
  for (const lookupError of [Object.assign(new Error('forbidden'), { stderr: 'gh: Forbidden (HTTP 403)' }), new Error('network unavailable')]) {
    const f = fixture({ lookupError });
    try {
      assert.throws(f.publish, error => error === lookupError);
      assert.ok(f.calls.every(call => call.args[1] !== 'create'));
    } finally { f.clean(); }
  }
});

test('fails safely for prereleases, missing tags, incomplete uploads, and immutable asset uploads', () => {
  for (const options of [
    { release: null },
    { listedReleases: [{ ...existing, draft: true }, { ...existing, draft: true }] },
    { release: { ...existing, prerelease: true } },
    { release: existing, refs: '' },
    { release: { ...existing, assets: [{ name: 'modelbeacon.vsix', state: 'starter' }] } },
    { release: { ...existing, assets: [] }, failUpload: true },
  ]) {
    const f = fixture(options);
    try {
      assert.throws(f.publish);
      assert.equal(readFileSync(f.artifact, 'utf8'), 'fresh VSIX');
      assert.ok(f.calls.every(call => call.args[1] !== 'edit' && !call.args.includes('--clobber')));
    } finally { f.clean(); }
  }
});

test('validates environment and local VSIX before any remote call', () => {
  for (const invalid of [{ tag: 'v0.4.5-beta' }, { sha: 'main' }, { repository: 'other/project' }]) {
    let called = false;
    assert.throws(() => publishGitHubRelease({ tag, sha, repository, ...invalid }, () => { called = true; return ''; }));
    assert.equal(called, false);
  }
  const f = fixture({ localManifest: { ...manifest, publisher: 'other' } });
  try {
    assert.throws(f.publish, /publisher/);
    assert.equal(f.calls.length, 1);
  } finally { f.clean(); }
});
