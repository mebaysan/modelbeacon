import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Command = (file: string, args: string[]) => string;
const command: Command = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function publishGitHubRelease(
  { tag, sha, repository, artifact = 'modelbeacon.vsix' }: { tag: string; sha: string; repository: string; artifact?: string },
  run: Command = command,
): void {
  assert.equal(repository, 'mebaysan/modelbeacon');
  assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(basename(artifact), 'modelbeacon.vsix');

  function validatePackage(path: string) {
    const manifest = JSON.parse(run('unzip', ['-p', path, 'extension/package.json']));
    assert.equal(manifest.name, 'modelbeacon', 'VSIX name does not match');
    assert.equal(manifest.publisher, 'mebaysan', 'VSIX publisher does not match');
    assert.equal(manifest.version, tag.slice(1), 'VSIX version does not match release tag');
  }
  validatePackage(artifact);

  const tagRef = `refs/tags/${tag}`;
  const refs = new Map(run('git', ['ls-remote', '--tags', `https://github.com/${repository}.git`, tagRef, `${tagRef}^{}`])
    .trim().split('\n').filter(Boolean).map(line => {
      const [hash, ref] = line.split(/\s+/);
      assert.match(hash, /^[a-f0-9]{40}$/);
      assert.ok(ref === tagRef || ref === `${tagRef}^{}`, 'Unexpected remote tag');
      return [ref, hash];
    }));
  const taggedCommit = refs.get(`${tagRef}^{}`) ?? refs.get(tagRef);
  if (taggedCommit) assert.equal(taggedCommit, sha, 'Existing release tag points to a different commit');

  let release;
  try {
    release = JSON.parse(run('gh', ['api', `repos/${repository}/releases/tags/${tag}`]));
  } catch (error) {
    // Authentication and network failures must not be mistaken for a missing release.
    if (!error || typeof error !== 'object' || !('stderr' in error) || !/\bHTTP 404\b/.test(String(error.stderr))) throw error;
    // The tag endpoint returns published releases; authenticated listings also include drafts.
    const matches = run('gh', ['api', '--paginate', `repos/${repository}/releases?per_page=100`, '--jq', `.[] | select(.tag_name == "${tag}") | @json`])
      .trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    assert.ok(matches.length <= 1, 'Multiple releases use this tag');
    release = matches[0];
  }
  if (release === undefined) {
    run('gh', ['release', 'create', tag, artifact, '--repo', repository, '--target', sha, '--generate-notes']);
    return;
  }

  assert.ok(release && typeof release === 'object', 'Invalid release response');
  assert.equal(release.tag_name, tag);
  assert.equal(release.prerelease, false, 'Prereleases cannot be published as stable versions');
  assert.equal(typeof release.draft, 'boolean');
  assert.ok(taggedCommit === sha || (release.draft && release.target_commitish === sha), 'Existing release has no matching remote tag or exact draft commit');
  assert.ok(Array.isArray(release.assets), 'Invalid release assets');
  const assets = release.assets.filter((asset: { name: string }) => asset.name === basename(artifact));
  assert.ok(assets.length <= 1, 'Release contains duplicate VSIX assets');
  if (assets.length) {
    assert.equal(assets[0].state, 'uploaded', 'Existing VSIX upload is incomplete');
    const temporary = mkdtempSync(join(dirname(resolve(artifact)), '.release-vsix-'));
    try {
      run('gh', ['release', 'download', tag, '--repo', repository, '--pattern', basename(artifact), '--dir', temporary]);
      const savedPackage = join(temporary, basename(artifact));
      validatePackage(savedPackage);
      // Reuse the published bytes on retries, including when Marketplace publication failed.
      renameSync(savedPackage, artifact);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  } else {
    run('gh', ['release', 'upload', tag, artifact, '--repo', repository]);
  }
  if (release.draft) run('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  publishGitHubRelease({
    tag: process.env.RELEASE_TAG ?? '',
    sha: process.env.GITHUB_SHA ?? '',
    repository: process.env.GH_REPO ?? '',
  });
}
