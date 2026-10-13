// Serves the exported web demo (dist/) the way GitHub Pages serves a project
// site, for the end-to-end tests: under HATED_BASE_URL (e.g. /Hated) or the
// root, files as they are, and 404.html, with status 404, for any other path.
// That fallback is what keeps the single-page app's deep links working.
//
//   node scripts/serve-demo.mjs        (PORT, default 4173)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const base = (process.env.HATED_BASE_URL ?? '').trim().replace(/\/+$/, '');
const port = Number(process.env.PORT ?? 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('No demo build in packages/mobile/dist. Run `npm run demo:export -w @hated/mobile` first.');
  process.exit(1);
}

http
  .createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (base !== '' && pathname === base) {
      response.writeHead(301, { Location: `${base}/` });
      response.end();
      return;
    }
    if (!pathname.startsWith(`${base}/`)) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not part of the site');
      return;
    }
    let file = path.join(root, pathname.slice(base.length));
    if (pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(root)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const found = fs.existsSync(file) && fs.statSync(file).isFile();
    const served = found ? file : path.join(root, '404.html');
    response.writeHead(found ? 200 : 404, { 'Content-Type': TYPES[path.extname(served)] ?? 'application/octet-stream' });
    fs.createReadStream(served).pipe(response);
  })
  .listen(port, () => console.log(`The demo: http://localhost:${port}${base}/`));
