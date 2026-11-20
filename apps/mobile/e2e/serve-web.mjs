#!/usr/bin/env node
/* eslint-disable no-console -- CLI script */
/**
 * Serves the app's web export (`expo export --platform web`) for E2E: static files, and the SPA
 * entry (index.html) for every other path so deep links like /phone work.
 * Usage: node e2e/serve-web.mjs <dir> <port>
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

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
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  const file = normalize(join(root, path));
  const inside = file.startsWith(root);
  const target =
    inside && existsSync(file) && statSync(file).isFile() ? file : join(root, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://localhost:${port}`));
