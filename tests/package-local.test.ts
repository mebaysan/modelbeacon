import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const { localReadme, withLocalReadme } = await import(new URL('../scripts/package-local.mjs', import.meta.url).href) as {
  localReadme: (markdown: string) => string;
  withLocalReadme: (markdown: string, run: (readmePath: string) => Promise<number>) => Promise<number>;
};

test('local README removes image lines and converts relative links while preserving text and external links', () => {
  const input = '# ModelBeacon\n\n![Hero](media/hero.png)\n\nUseful guidance.\n\n'
    + '[Guide](docs/development.md) · [Privacy](PRIVACY.md) · [Author](https://mebaysan.com)\n'
    + '[Email](mailto:hello@example.com) · [Section](#commands)\n';
  assert.equal(localReadme(input), '# ModelBeacon\n\nUseful guidance.\n\n'
    + 'Guide (`docs/development.md`) · Privacy (`PRIVACY.md`) · [Author](https://mebaysan.com)\n'
    + '[Email](mailto:hello@example.com) · [Section](#commands)\n');
});

test('unsupported inline/reference images, HTML, unsafe schemes and complex links fail closed', () => {
  for (const input of [
    'Text ![inline](media/image.png)', '![image][hero]\n[hero]: media/image.png',
    '<img src="media/image.png">', '<picture><source srcset="media/image.png"></picture>',
    '[Open](command:workbench.action.files.openFile)', '[Local](file:///tmp/readme.md)',
    '[Data](data:text/plain,test)', '[Guide](docs/guide.md "title")',
    '[Guide](docs/guide(test).md)', '[Read [guide]](docs/guide.md)', '[Guide][reference]\n[reference]: docs/guide.md',
  ]) assert.throws(() => localReadme(input), /unsupported/i);
});

test('canonical README produces no unresolved local links or images without changing its source', async () => {
  const sourcePath = new URL('../README.md', import.meta.url);
  const source = await readFile(sourcePath, 'utf8');
  const output = localReadme(source);
  assert.match(source, /!\[[^\]]*\]\(media\//, 'Keep images in the canonical README');
  assert.doesNotMatch(output, /!\[/);
  assert.match(output, /Development and installation \(`docs\/development.md`\)/);
  for (const match of output.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    assert.match(match[1], /^(?:https:\/\/|mailto:|#)/);
  }
  assert.equal(await readFile(sourcePath, 'utf8'), source);
});

test('temporary README is cleaned after success and nonzero packaging exit codes are preserved', async () => {
  for (const code of [0, 17]) {
    let temporary = '';
    const result = await withLocalReadme('# ModelBeacon\n\n![Hero](media/hero.png)\n', async readmePath => {
      temporary = readmePath;
      const repository = fileURLToPath(new URL('..', import.meta.url));
      assert.match(path.relative(repository, readmePath), /^\.modelbeacon-package-[^/\\]+[/\\]README\.md$/);
      assert.equal(await readFile(readmePath, 'utf8'), '# ModelBeacon\n\n');
      return code;
    });
    assert.equal(result, code);
    await assert.rejects(access(temporary), { code: 'ENOENT' });
    await assert.rejects(access(path.dirname(temporary)), { code: 'ENOENT' });
  }
});

test('temporary README is cleaned when launching the packager fails', async () => {
  let temporary = '';
  await assert.rejects(withLocalReadme('# ModelBeacon\n', async readmePath => {
    temporary = readmePath;
    throw new Error('Packager failed to start');
  }), /Packager failed to start/);
  await assert.rejects(access(path.dirname(temporary)), { code: 'ENOENT' });
});
