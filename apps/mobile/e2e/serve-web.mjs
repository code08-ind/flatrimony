#!/usr/bin/env node
/* eslint-disable no-console -- CLI script */
/**
 * Serves the app's web export (`expo export --platform web`) for E2E: static files, and the SPA
 * entry (index.html) for every other path so deep links like /phone work.
 * Usage: node e2e/serve-web.mjs <dir> <port>
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist-web');
const port = Number(process.argv[3] ?? 8081);
if (!existsSync(join(root, 'index.html'))) {
  console.error(
    `No web export in ${root}: run \`pnpm --filter @flatrimony/mobile export:web\` first.`,
  );
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = resolve(root, `.${path}`);
  const inside = file === root || file.startsWith(root + sep);
  if (inside && existsSync(file) && statSync(file).isFile()) return send(res, file);
  // A missing asset is a 404 (a broken script path must not come back as HTML); any other path is
  // a screen of the app (SPA entry).
  if (extname(path)) {
    res.writeHead(404).end();
    return;
  }
  send(res, join(root, 'index.html'));
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://localhost:${port}`));

function send(res, file) {
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}
