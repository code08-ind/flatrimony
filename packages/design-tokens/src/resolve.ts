/**
 * Minimal W3C Design Tokens (DTCG) reader: flattens the token tree, inherits `$type`
 * from groups and resolves `{path.to.token}` references. Pure; no I/O.
 */

export type TokenValue = string | number | number[] | string[] | Record<string, unknown>;

export interface FlatToken {
  /** Dot path, e.g. `color.brand.primary`. */
  path: string;
  type: string | undefined;
  value: TokenValue;
  description?: string;
  /** Path this token aliases, if its value was a reference. */
  aliasOf?: string;
}

type Node = Record<string, unknown>;

const REF = /^\{([^{}]+)\}$/;

function isTokenNode(node: unknown): node is Node & { $value: TokenValue } {
  return typeof node === 'object' && node !== null && '$value' in node;
}

function walk(node: Node, prefix: string[], inheritedType: string | undefined, out: FlatToken[]) {
  const groupType = typeof node.$type === 'string' ? node.$type : inheritedType;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const path = [...prefix, key];
    if (isTokenNode(child)) {
      const type = typeof child.$type === 'string' ? child.$type : groupType;
      const token: FlatToken = { path: path.join('.'), type, value: child.$value };
      if (typeof child.$description === 'string') token.description = child.$description;
      out.push(token);
    } else if (typeof child === 'object' && child !== null) {
      walk(child as Node, path, groupType, out);
    }
  }
}

/** Flattens and resolves every token. Throws on missing or circular references. */
export function flattenTokens(tree: Node): FlatToken[] {
  const raw: FlatToken[] = [];
  walk(tree, [], undefined, raw);
  const byPath = new Map(raw.map((t) => [t.path, t]));

  const resolve = (token: FlatToken, seen: string[]): FlatToken => {
    if (typeof token.value !== 'string') return token;
    const match = REF.exec(token.value);
    if (!match) return token;
    const targetPath = match[1]!;
    if (seen.includes(targetPath)) {
      throw new Error(`Circular token reference: ${[...seen, targetPath].join(' -> ')}`);
    }
    const target = byPath.get(targetPath);
    if (!target) throw new Error(`Token ${token.path} references missing token {${targetPath}}`);
    const resolved = resolve(target, [...seen, targetPath]);
    return {
      ...token,
      type: token.type ?? resolved.type,
      value: resolved.value,
      aliasOf: targetPath,
    };
  };

  return raw.map((t) => resolve(t, [t.path]));
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Builds a nested object of resolved values from flat tokens. Objects are created without a
 * prototype and prototype-related path segments are rejected, so a token path can never
 * pollute Object.prototype.
 */
export function toNested(flat: FlatToken[]): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null);
  for (const token of flat) {
    const parts = token.path.split('.');
    const bad = parts.find((p) => FORBIDDEN_KEYS.has(p));
    if (bad) throw new Error(`Token path ${token.path} uses forbidden segment "${bad}"`);
    let cursor = root;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(cursor, part)) cursor[part] = Object.create(null);
      // Safe: prototype segments are rejected above and every level is Object.create(null).
      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]!] = token.value;
  }
  return root;
}
