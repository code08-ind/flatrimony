import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssVarName, flatTokens } from '@flatrimony/design-tokens';

const css = readFileSync(join(import.meta.dirname, '../app/globals.css'), 'utf8');

describe('admin styles use design tokens only', () => {
  it('every var(--…) referenced in globals.css exists in the tokens package (or is a next/font variable)', () => {
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
