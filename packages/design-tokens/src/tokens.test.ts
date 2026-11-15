import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  color,
  contrastRatio,
  flatTokens,
  font,
  lineHeightFor,
  nativeTheme,
  radius,
  semantic,
  space,
  tailwindPreset,
  tokenTree,
  toCss,
  typography,
} from './index.js';
import { flattenTokens } from './resolve.js';
import { parseHex } from './contrast.js';
import { cssValue } from './outputs.js';

const root = join(import.meta.dirname, '..');

describe('source of truth', () => {
  it('tokens.data.ts is in sync with tokens.json (run `pnpm generate` after editing)', () => {
    const json = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));
    expect(tokenTree).toEqual(json);
  });

  it('every token has a type and a resolved value', () => {
    for (const t of flatTokens) {
      expect(t.type, t.path).toBeDefined();
      expect(typeof t.value === 'string' && t.value.startsWith('{'), t.path).toBe(false);
    }
  });
});

describe('brand palette (docs/06 §3.1)', () => {
  it('uses the founder-fixed brand colours', () => {
    expect(color.brand.primary).toBe('#4A2FBD');
    expect(color.accent.lime).toBe('#D7F26B');
    expect(color.bg.app).toBe('#F5F2EA');
    expect(color.match.likePink).toBe('#C2185B');
  });

  it('Rishta pink #C2185B is used for likes only', () => {
    const users = flatTokens
      .filter((t) => typeof t.value === 'string' && t.value.toUpperCase() === '#C2185B')
      .map((t) => t.path)
      .sort();
    expect(users).toEqual(['color.match.likePink', 'semantic.match.like']);
  });

  it('semantic tokens map to the documented base tokens', () => {
    expect(semantic.action.primary).toEqual({ bg: '#4A2FBD', fg: '#FFFFFF' });
    expect(semantic.selection).toEqual({ bg: '#D7F26B', fg: '#17141F' });
    expect(semantic.match.score).toEqual({ bg: '#D7F26B', fg: '#17141F' });
    expect(semantic.status.verified).toEqual({ bg: '#E6F5EC', fg: '#166B40' });
    expect(color.focus).toBe(color.brand.primary);
  });
});

describe('measured contrast (WCAG 2.x)', () => {
  const W = '#FFFFFF';
  // [foreground, background, minimum ratio] — the passing pairs in docs/06 §3.1.
  const passing: [string, string, string, string, number][] = [
    ['text.primary', 'bg.app', color.text.primary, color.bg.app, 4.5],
    ['text.secondary', 'bg.surface', color.text.secondary, color.bg.surface, 4.5],
    ['text.secondary', 'bg.app', color.text.secondary, color.bg.app, 4.5],
    ['white', 'brand.primary', W, color.brand.primary, 4.5],
    ['brand.primary', 'brand.primarySubtle', color.brand.primary, color.brand.primarySubtle, 4.5],
    ['text.primary', 'accent.lime', color.text.primary, color.accent.lime, 4.5],
    ['brand.primary', 'accent.lime', color.brand.primary, color.accent.lime, 4.5],
    ['accent.lime', 'bg.immersive', color.accent.lime, color.bg.immersive, 4.5],
    ['text.primary', 'brand.lavender', color.text.primary, color.brand.lavender, 4.5],
    ['white', 'match.likePink', W, color.match.likePink, 4.5],
    ['white', 'bg.immersive', W, color.bg.immersive, 4.5],
    ['white', 'accent.green', W, color.accent.green, 4.5],
    ['accent.greenText', 'accent.greenSubtle', color.accent.greenText, color.accent.greenSubtle, 4.5],
    ['text.primary', 'accent.yellow', color.text.primary, color.accent.yellow, 4.5],
    ['accent.yellowText', 'accent.yellowSubtle', color.accent.yellowText, color.accent.yellowSubtle, 4.5],
    ['white', 'danger', W, color.danger, 4.5],
    ['danger', 'dangerSubtle', color.danger, color.dangerSubtle, 4.5],
    ['accent.blue', 'accent.blueSubtle', color.accent.blue, color.accent.blueSubtle, 4.5],
    ['border.strong', 'bg.surface (UI component)', color.border.strong, color.bg.surface, 3],
    ['text.disabled', 'bg.surface (large text only)', color.text.disabled, color.bg.surface, 3],
  ];

  it.each(passing)('%s on %s meets its minimum', (_f, _b, fg, bg, min) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it('documented "never use" pairs really fail, so the rule stays enforced', () => {
    expect(contrastRatio(W, color.brand.lavender)).toBeLessThan(3);
    expect(contrastRatio(color.accent.lime, color.bg.surface)).toBeLessThan(3);
  });

  it('every semantic fg/bg pair passes AA for text', () => {
    const pairs = [
      semantic.action.primary,
      semantic.action.destructive,
      semantic.selection,
      semantic.match.score,
      ...Object.values(semantic.status),
    ];
    for (const { fg, bg } of pairs) expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('contrast maths matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(() => parseHex('red')).toThrow();
  });
});

describe('type, spacing, radii', () => {
  it('uses Plus Jakarta Sans for Latin and Noto Sans Devanagari for Hindi', () => {
    expect(font.family.latin[0]).toBe('Plus Jakarta Sans');
    expect(font.family.devanagari[0]).toBe('Noto Sans Devanagari');
  });

  it('spacing is the documented 4-point scale', () => {
    expect(Object.values(space)).toEqual([0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64]);
    for (const v of Object.values(space)) expect(v % 4).toBe(0);
  });

  it('radii match docs/06 §3.4', () => {
    expect(radius).toEqual({ sm: 12, md: 16, lg: 24, xl: 32, full: 9999 });
  });

  it('type scale weights stay within 400/500/600/700/800', () => {
    for (const t of Object.values(typography)) expect([400, 500, 600, 700, 800]).toContain(t.fontWeight);
    expect(typography.h1).toEqual({ fontSize: 26, lineHeight: 32, fontWeight: 700, letterSpacing: -0.01 });
  });

  it('Hindi line height is at least 1.6x the font size', () => {
    for (const t of Object.values(typography)) {
      expect(lineHeightFor(t, 'hi')).toBeGreaterThanOrEqual(t.fontSize * 1.6);
      expect(lineHeightFor(t, 'en')).toBe(t.lineHeight);
    }
  });
});

describe('outputs', () => {
  it('emits CSS custom properties', () => {
    const css = toCss([...flatTokens]);
    expect(css).toContain('--color-brand-primary: #4A2FBD;');
    expect(css).toContain('--semantic-match-like: #C2185B;');
    expect(css).toContain('--space-5: 20px;');
    expect(css).toContain('--radius-full: 9999px;');
    expect(css).toContain('--font-family-latin: "Plus Jakarta Sans", system-ui, sans-serif;');
    expect(css).toContain('--motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);');
    expect(css).toContain('--elevation-2: 0px 4px 12px 0px rgba(28,27,41,0.10);');
    expect(css).not.toContain('[object Object]');
  });

  it('skips composite tokens with no CSS form', () => {
    expect(cssValue({ path: 'x', type: 'typography', value: {} })).toBeUndefined();
  });

  it('builds a Tailwind/NativeWind preset with shared names', () => {
    const ext = tailwindPreset.theme.extend;
    expect(ext.colors.brand).toMatchObject({ primary: '#4A2FBD' });
    expect(ext.spacing['5']).toBe('20px');
    expect(ext.borderRadius.xl).toBe('32px');
    expect(ext.fontFamily.devanagari[0]).toBe('Noto Sans Devanagari');
    expect(ext.fontSize.h1).toEqual(['26px', { lineHeight: '32px', fontWeight: '700', letterSpacing: '-0.01em' }]);
  });

  it('builds a React Native theme with unitless values', () => {
    expect(nativeTheme.space['5']).toBe(20);
    expect(nativeTheme.typography.display.letterSpacing).toBe(-0.48);
    expect(nativeTheme.elevation['2']).toMatchObject({ shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1 });
  });
});

describe('resolver', () => {
  it('inherits group $type and resolves chains of references', () => {
    const flat = flattenTokens({
      c: { $type: 'color', a: { $value: '#000000' }, b: { $value: '{c.a}' }, d: { $value: '{c.b}' } },
    });
    expect(flat.find((t) => t.path === 'c.d')).toMatchObject({ type: 'color', value: '#000000', aliasOf: 'c.b' });
  });

  it('rejects missing and circular references', () => {
    expect(() => flattenTokens({ a: { $value: '{nope}' } })).toThrow(/missing/);
    expect(() => flattenTokens({ a: { $value: '{b}' }, b: { $value: '{a}' } })).toThrow(/Circular/);
  });
});
