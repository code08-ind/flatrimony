import {
  lineHeightFor,
  nativeTheme,
  typography,
  type TypographyRole,
} from '@flatrimony/design-tokens';
import type { Locale } from '@flatrimony/i18n';

export const theme = nativeTheme;

type Weight = '400' | '500' | '600' | '700' | '800';

/** Font faces loaded in app/_layout.tsx, keyed by locale and weight. */
export const FONT_FILES: Record<Locale, Record<Weight, string>> = {
  en: {
    '400': 'PlusJakartaSans_400Regular',
    '500': 'PlusJakartaSans_500Medium',
    '600': 'PlusJakartaSans_600SemiBold',
    '700': 'PlusJakartaSans_700Bold',
    '800': 'PlusJakartaSans_800ExtraBold',
  },
  hi: {
    '400': 'NotoSansDevanagari_400Regular',
    '500': 'NotoSansDevanagari_500Medium',
    '600': 'NotoSansDevanagari_600SemiBold',
    '700': 'NotoSansDevanagari_700Bold',
    // Devanagari headings use Bold 700 at most (docs/06 §13).
    '800': 'NotoSansDevanagari_700Bold',
  },
};

export interface TextStyleSpec {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  color: string;
}

/**
 * Text style for a type-scale role. React Native selects the face by family name, so the weight is
 * encoded in the family. Hindi gets >= 1.6x line height and no negative tracking (docs/06 §3.2).
 */
export function textStyle(role: TypographyRole, locale: Locale): TextStyleSpec {
  const t = typography[role];
  return {
    fontFamily: FONT_FILES[locale][String(t.fontWeight) as Weight],
    fontSize: t.fontSize,
    lineHeight: lineHeightFor(t, locale),
    letterSpacing: locale === 'en' ? theme.typography[role].letterSpacing : 0,
    color: theme.color.text.primary,
  };
}
