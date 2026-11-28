import { afterEach, describe, expect, it } from 'vitest';
import { _MinimalPluralRules, ensurePluralRules } from './plural-rules.js';
import { t } from './index.js';

const NATIVE = Intl.PluralRules;
afterEach(() => {
  (Intl as { PluralRules: unknown }).PluralRules = NATIVE;
});

describe('the minimal Intl.PluralRules (Hermes has none)', () => {
  const numbers = [0, 0.5, 1, 1.0, 1.5, 2, 3, 7, 11, 21, 100, 101, 1000, -1, -2];
  it.each(['en', 'en-IN', 'hi', 'hi-IN'])('matches CLDR cardinal rules for %s', (locale) => {
    const real = new NATIVE(locale);
    const mine = new _MinimalPluralRules(locale);
    for (const n of numbers) expect(mine.select(n), `${locale} ${n}`).toBe(real.select(n));
  });

  it('answers "other" for ordinals and odd input', () => {
    expect(new _MinimalPluralRules('en', { type: 'ordinal' }).select(1)).toBe('other');
    expect(new _MinimalPluralRules('en').select(Number.NaN)).toBe('other');
    expect(new _MinimalPluralRules(['hi-IN', 'en']).resolvedOptions().locale).toBe('hi-IN');
    expect(_MinimalPluralRules.supportedLocalesOf(['hi-IN', 'fr', 'en'])).toEqual(['hi-IN', 'en']);
  });

  it('is installed only where it is missing', () => {
    expect(ensurePluralRules({ Intl })).toBe(false);
    expect(Intl.PluralRules).toBe(NATIVE);
    const bare: { Intl?: typeof Intl } = { Intl: {} as typeof Intl };
    expect(ensurePluralRules(bare)).toBe(true);
    expect(new bare.Intl!.PluralRules('hi').select(0)).toBe('one');
  });

  it('plural messages format with it in both languages', () => {
    delete (Intl as { PluralRules?: unknown }).PluralRules;
    expect(ensurePluralRules()).toBe(true);
    expect(t('en', 'listing.editor.review.photosCount', { count: 1 })).toBe('1 photo');
    expect(t('en', 'listing.editor.review.photosCount', { count: 3 })).toBe('3 photos');
    expect(t('en', 'listing.myFlat.status.active', { days: 7 })).toBe('Active · expires in 7 days');
    expect(t('hi', 'listing.editor.review.photosCount', { count: 3 })).toContain('3');
  });
});
