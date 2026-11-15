import { flattenTokens, toNested, type FlatToken } from './resolve.js';
import { tokenTree } from './tokens.data.js';

export { contrastRatio, relativeLuminance, parseHex } from './contrast.js';
export { flattenTokens, toNested, type FlatToken } from './resolve.js';
export { toCss, cssVarName, cssValue } from './outputs.js';
export { tokenTree };

export interface TypographyStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
  /** Fraction of font size (e.g. -0.02 = -2%). */
  letterSpacing: number;
}

export interface Shadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
}

/** Every token, flattened with references resolved. */
export const flatTokens: readonly FlatToken[] = flattenTokens(
  tokenTree as unknown as Record<string, unknown>,
);

const nested = toNested([...flatTokens]) as Record<string, Record<string, unknown>>;

type ColorGroup = { [key: string]: string | ColorGroup };

export const color = nested.color as {
  brand: { primary: string; primaryPressed: string; primarySubtle: string; lavender: string };
  accent: {
    lime: string;
    green: string;
    greenText: string;
    greenSubtle: string;
    yellow: string;
    yellowText: string;
    yellowSubtle: string;
    blue: string;
    blueSubtle: string;
  };
  match: { likePink: string; likeSubtle: string };
  danger: string;
  dangerSubtle: string;
  white: string;
  bg: { app: string; surface: string; immersive: string };
  text: { primary: string; secondary: string; disabled: string };
  border: { default: string; strong: string };
  focus: string;
};

export const semantic = nested.semantic as {
  action: {
    primary: { bg: string; fg: string };
    secondary: { bg: string; fg: string; border: string };
    destructive: { bg: string; fg: string };
  };
  status: Record<'verified' | 'pending' | 'error' | 'info', { bg: string; fg: string }>;
  selection: { bg: string; fg: string };
  match: { score: { bg: string; fg: string }; like: string; pass: string; superLike: string };
  tile: { bentoPrimary: string; bentoLavender: string };
};

export const glass = nested.glass as {
  dark: { fill: string; blur: number; border: string; fallback: string };
  light: { fill: string; blur: number; border: string };
};

export const scrim = nested.scrim as { photo: { from: string; to: string; coverage: number } };

export const font = nested.font as {
  family: { latin: string[]; devanagari: string[] };
  weight: Record<'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold', number>;
  devanagariLineHeightRatio: number;
};

export type TypographyRole =
  | 'hero'
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bodyLg'
  | 'body'
  | 'label'
  | 'caption'
  | 'micro';

export const typography = nested.typography as Record<TypographyRole, TypographyStyle>;

export const space = nested.space as Record<
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '8' | '10' | '12' | '16',
  number
>;
export const layout = nested.layout as Record<
  'screenPaddingMobile' | 'webContentMax' | 'webSidePadding' | 'sectionGap' | 'cardPadding' | 'dockReserve',
  number
>;
export const radius = nested.radius as Record<'sm' | 'md' | 'lg' | 'xl' | 'full', number>;
export const borderWidth = nested.borderWidth as Record<'default' | 'focus', number>;
export const elevation = nested.elevation as Record<'1' | '2' | '3', Shadow>;
export const size = nested.size as {
  touchMin: number;
  touchMinWeb: number;
  icon: Record<'sm' | 'md' | 'lg', number>;
  avatar: Record<'sm' | 'md' | 'lg' | 'xl', number>;
  button: { primary: number; compact: number; primaryMobileFullWidth: number };
  dock: number;
};
export const breakpoint = nested.breakpoint as Record<'sm' | 'md' | 'lg', number>;
export const motion = nested.motion as {
  fast: number;
  base: number;
  slow: number;
  easing: { standard: number[]; emphasized: number[] };
  spring: { card: { damping: number; stiffness: number } };
};

/** Line height for a style in a given locale; Devanagari needs >= 1.6x the font size. */
export function lineHeightFor(style: TypographyStyle, locale: 'en' | 'hi'): number {
  if (locale === 'en') return style.lineHeight;
  return Math.max(style.lineHeight, Math.ceil(style.fontSize * font.devanagariLineHeightRatio));
}

function shadowCss(s: Shadow): string {
  return `${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${s.color}`;
}

const px = (n: number) => `${n}px`;
const mapValues = <T, U>(obj: Record<string, T>, fn: (v: T) => U): Record<string, U> =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));

/**
 * Tailwind theme extension (Tailwind v3 preset format, also used by NativeWind).
 * Token names are identical on web and mobile: `bg-brand-primary`, `p-5`, `rounded-xl`, `text-h1`.
 */
export const tailwindPreset = {
  theme: {
    extend: {
      colors: { ...color, semantic } as unknown as ColorGroup,
      spacing: mapValues(space, px),
      borderRadius: mapValues(radius, px),
      borderWidth: mapValues(borderWidth, px),
      fontFamily: { sans: font.family.latin, devanagari: font.family.devanagari },
      fontSize: Object.fromEntries(
        Object.entries(typography).map(([k, t]) => [
          k,
          [
            px(t.fontSize),
            {
              lineHeight: px(t.lineHeight),
              fontWeight: String(t.fontWeight),
              letterSpacing: `${t.letterSpacing}em`,
            },
          ],
        ]),
      ),
      boxShadow: mapValues(elevation, shadowCss),
      screens: mapValues(breakpoint, px),
      transitionDuration: { fast: `${motion.fast}ms`, base: `${motion.base}ms`, slow: `${motion.slow}ms` },
    },
  },
} as const;

/** React Native theme: unitless numbers, RN shadow props, letter spacing in points. */
export const nativeTheme = {
  color,
  semantic,
  glass,
  space,
  layout,
  radius,
  borderWidth,
  size,
  motion,
  typography: Object.fromEntries(
    Object.entries(typography).map(([k, t]) => [
      k,
      {
        fontSize: t.fontSize,
        lineHeight: t.lineHeight,
        fontWeight: String(t.fontWeight) as '400' | '500' | '600' | '700' | '800',
        letterSpacing: Math.round(t.fontSize * t.letterSpacing * 100) / 100,
      },
    ]),
  ) as Record<
    TypographyRole,
    {
      fontSize: number;
      lineHeight: number;
      fontWeight: '400' | '500' | '600' | '700' | '800';
      letterSpacing: number;
    }
  >,
  elevation: mapValues(elevation, (s) => ({
    shadowColor: '#1C1B29',
    shadowOffset: { width: s.offsetX, height: s.offsetY },
    shadowRadius: s.blur / 2,
    shadowOpacity: Number(/,\s*([\d.]+)\)$/.exec(s.color)?.[1] ?? 0),
    elevation: s.offsetY,
  })),
} as const;
