import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT || 4173);
const routes = {
  '/webview.js': ['dist/webview.js', 'text/javascript'],
  '/webview.css': ['dist/webview.css', 'text/css'],
  '/activity-bar.svg': ['dist/activity-bar.svg', 'image/svg+xml'],
  '/preview.js': ['scripts/preview-client.js', 'text/javascript'],
  '/catalog.json': ['data/catalog.json', 'application/json'],
};
createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (path === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self';");
      res.end('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ModelBeacon · Development preview</title><link rel="stylesheet" href="/webview.css"></head><body><main id="app"></main><script src="/preview.js"></script><script src="/webview.js"></script></body></html>');
    } else if (routes[path]) {
      const [file, type] = routes[path];
      res.setHeader('Content-Type', `${type}; charset=utf-8`);
      res.end(await readFile(file));
    } else {
      res.writeHead(404).end();
    }
  } catch {
    res.writeHead(500).end('Build the extension and validate the catalog first.');
  }
}).listen(port, '127.0.0.1', () => console.log(`Development preview: http://127.0.0.1:${port} (fixture discovery only)`));
