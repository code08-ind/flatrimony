import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssVarName, flatTokens } from '@flatrimony/design-tokens';

// Every stylesheet of the app (globals.css, ui.css, …).
const appDir = join(import.meta.dirname, '../app');
const css = readdirSync(appDir, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(appDir, f), 'utf8'))
  .join('\n');

describe('web styles use design tokens only', () => {
  it('every var(--…) referenced in the app CSS exists in the tokens package (or is a next/font variable)', () => {
    const known = new Set(flatTokens.map((t) => cssVarName(t.path)));
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!);
    const unknown = used.filter(
      (v) => !known.has(v) && !v.startsWith('--font-latin') && !v.startsWith('--font-devanagari'),
    );
    expect(unknown).toEqual([]);
  });

  it('contains no raw hex colours (Rishta pink stays likes-only via tokens)', () => {
    expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });
});
