/**
 * Regenerates derived files from tokens.json:
 *   - src/tokens.data.ts  (the token tree as a typed TS module, so every bundler can import it)
 *   - dist/css/tokens.css (CSS custom properties for web, admin and Tailwind v4 `@theme` use)
 * Run: pnpm --filter @flatrimony/design-tokens generate
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenTokens } from '../src/resolve.js';
import { toCss } from '../src/outputs.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tree = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8')) as Record<string, unknown>;

const mode = process.argv[2] ?? 'all';

if (mode === 'all' || mode === 'data') {
  const data =
    '// Generated from tokens.json by scripts/generate.ts. Do not edit; edit tokens.json instead.\n' +
    `export const tokenTree = ${JSON.stringify(tree, null, 2)} as const;\n`;
  writeFileSync(join(root, 'src/tokens.data.ts'), data);
}

if (mode === 'all' || mode === 'css') {
  mkdirSync(join(root, 'dist/css'), { recursive: true });
  writeFileSync(join(root, 'dist/css/tokens.css'), toCss(flattenTokens(tree)));
}
