import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

function versionParts(version: unknown): bigint[] {
  assert.ok(typeof version === 'string', 'Version must be a string');
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Release versions must be stable major.minor.patch values');
  return version.split('.').map(BigInt);
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.equal(manifest.publisher, 'mebaysan', 'Unexpected publisher');
assert.equal(manifest.name, 'modelbeacon', 'Unexpected package name');
const current = versionParts(manifest.version);
assert.equal(lock.version, manifest.version, 'Lockfile version must match package.json');
assert.equal(lock.packages[''].version, manifest.version, 'Lockfile root package version must match package.json');

let release: boolean;
if (process.env.GITHUB_EVENT_NAME === 'push') {
  const before = process.env.BEFORE_SHA ?? '';
  assert.match(before, /^[a-f0-9]{40}$/, 'Previous push commit must be a full SHA');
  assert.notEqual(before, '0'.repeat(40), 'Cannot detect a version upgrade on a newly created branch');
  // Compare the entire push, which may contain multiple commits, rather than HEAD's parent.
  const previous = versionParts(JSON.parse(execFileSync('git', ['show', `${before}:package.json`], { encoding: 'utf8' })).version);
  const changed = current.findIndex((part, index) => part !== previous[index]);
  assert.ok(changed === -1 || current[changed] > previous[changed], 'Release version must increase; downgrades cannot be published');
  release = changed !== -1;
} else {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'release', 'Unsupported release trigger');
  assert.equal(process.env.RELEASE_TAG, `v${manifest.version}`, 'Release tag must match package.json');
  release = true;
}

assert.ok(process.env.GITHUB_OUTPUT, 'GitHub Actions output path is required');
appendFileSync(process.env.GITHUB_OUTPUT, `release=${release}\ntag=v${manifest.version}\n`);
console.log(release ? `Release v${manifest.version} validated.` : 'Version unchanged; no release needed.');
