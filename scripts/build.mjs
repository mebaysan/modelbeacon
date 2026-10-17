import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const catalogUrl = process.env.LLMBENCH_CATALOG_URL || '';
if (catalogUrl) {
  const url = new URL(catalogUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Catalog URL must use HTTPS without credentials.');
}
await mkdir('dist', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], define: { __CATALOG_URL__: JSON.stringify(catalogUrl) } }),
  build({ entryPoints: ['webview/app.ts'], outfile: 'dist/webview.js', bundle: true, platform: 'browser', target: 'es2022', minify: true }),
  copyFile('webview/styles.css', 'dist/webview.css'),
  copyFile('media/activity-bar.svg', 'dist/activity-bar.svg'),
]);
console.log(`Built extension and webview. Catalog feed: ${catalogUrl || 'unpublished (bundled catalog only)'}`);
