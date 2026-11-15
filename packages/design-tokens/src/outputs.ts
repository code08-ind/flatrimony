import type { FlatToken } from './resolve.js';

const PX_TYPES = new Set(['dimension']);

function kebab(path: string): string {
  return path.replace(/\./g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function cssVarName(path: string): string {
  return `--${kebab(path)}`;
}

/** Serialises one token value for CSS, or returns undefined when it has no CSS form. */
export function cssValue(token: FlatToken): string | undefined {
  const { type, value } = token;
  switch (type) {
    case 'color':
      return String(value);
    case 'dimension':
      return `${value as number}px`;
    case 'duration':
      return `${value as number}ms`;
    case 'number':
    case 'fontWeight':
      return String(value);
    case 'fontFamily':
      return (value as string[]).map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ');
    case 'cubicBezier':
      return `cubic-bezier(${(value as number[]).join(', ')})`;
    case 'shadow': {
      const s = value as { offsetX: number; offsetY: number; blur: number; spread: number; color: string };
      return `${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${s.color}`;
    }
    default:
      return undefined; // typography and spring are composite; consumed from JS.
  }
}

/** `:root { --color-brand-primary: #4A2FBD; ... }` */
export function toCss(flat: FlatToken[]): string {
  const lines = flat
    .map((t) => {
      const v = cssValue(t);
      return v === undefined ? undefined : `  ${cssVarName(t.path)}: ${v};`;
    })
    .filter((l): l is string => l !== undefined);
  return `/* Generated from packages/design-tokens/tokens.json. Do not edit. */\n:root {\n${lines.join('\n')}\n}\n`;
}

export { PX_TYPES };
