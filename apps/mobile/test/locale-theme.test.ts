import { describe, expect, it, vi } from 'vitest';

// theme.ts imports only type-level react-native; mock nothing heavy.
vi.mock('react-native', () => ({}));

import { pickLocale } from '../src/locale';
import { FONT_FILES, textStyle, theme } from '../src/theme';

describe('pickLocale', () => {
  it('prefers Hindi when the device does', () => {
    expect(pickLocale(['hi-IN', 'en-IN'])).toBe('hi');
    expect(pickLocale(['en-IN', 'hi-IN'])).toBe('en');
    expect(pickLocale(['hi'])).toBe('hi');
  });

  it('falls back to English for other languages', () => {
    expect(pickLocale(['ta-IN', 'fr'])).toBe('en');
    expect(pickLocale([])).toBe('en');
    expect(pickLocale([null, undefined])).toBe('en');
  });
});

describe('theme', () => {
  it('uses the brand tokens', () => {
    expect(theme.color.brand.primary).toBe('#4A2FBD');
    expect(theme.color.bg.app).toBe('#F5F2EA');
    expect(theme.layout.screenPaddingMobile).toBe(20);
  });

  it('maps type roles to the right font face per locale', () => {
    expect(textStyle('display', 'en')).toMatchObject({
      fontFamily: 'PlusJakartaSans_800ExtraBold',
      fontSize: 32,
      lineHeight: 38,
    });
    const hi = textStyle('display', 'hi');
    expect(hi.fontFamily).toBe('NotoSansDevanagari_700Bold');
    expect(hi.lineHeight).toBeGreaterThanOrEqual(32 * 1.6);
    expect(hi.letterSpacing).toBe(0);
    expect(textStyle('body', 'en').fontFamily).toBe(FONT_FILES.en['400']);
  });
});
