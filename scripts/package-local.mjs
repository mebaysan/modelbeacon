import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// shortcut: supports this README's simple Markdown; extend when its authoring format changes.
export function localReadme(markdown) {
  let result = markdown.replace(/^[\t ]*!\[[^\]\r\n]*\]\([^()\r\n]+\)[\t ]*(?:\r?\n|$)/gm, '');
  if (/!\[|<\/?[a-z][^>]*>/i.test(result)) {
    throw new Error('Local README contains unsupported inline images or HTML. Use standalone Markdown image lines.');
  }
  const links = /\[([^\]\r\n]+)\]\(([^()\s]+)\)/g;
  result = result.replace(links, (match, label, target) => {
    if (/^(?:https:\/\/|mailto:|#)/.test(target)) return match;
    if (!/^[a-z0-9_./-]+(?:#[a-z0-9_.-]+)?$/i.test(target)) {
      throw new Error(`Unsupported local README link: ${target}`);
    }
    return `${label} (\`${target}\`)`;
  });
  const remaining = result.replace(links, '');
  if (/\]\(|\]\[|^[\t ]*\[[^\]\r\n]+\]:/m.test(remaining)) {
    throw new Error('Local README contains unsupported Markdown links. Use simple inline links.');
  }
  return result.replace(/\n{3,}/g, '\n\n');
}

export async function withLocalReadme(markdown, run) {
  const content = localReadme(markdown);
  // vsce only discovers alternate README files inside the extension directory.
  const directory = await mkdtemp(path.join(root, '.modelbeacon-package-'));
  const readmePath = path.join(directory, 'README.md');
  try {
    await writeFile(readmePath, content);
    return await run(readmePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const markdown = await readFile(path.join(root, 'README.md'), 'utf8');
  process.exitCode = await withLocalReadme(markdown, readmePath => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce'),
      'package', '--allow-missing-repository', '--no-rewrite-relative-links',
      '--readme-path', path.relative(root, readmePath).split(path.sep).join('/'), '--out', 'modelbeacon.vsix',
    ], { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 1));
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
