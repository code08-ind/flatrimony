/** Contract tests: shared enums and the SQL migrations must never drift (docs/00 "contracts first"). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENUMS } from './enums.js';

const migrationsDir = join(import.meta.dirname, '../../../supabase/migrations');
const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
  .join('\n');

function sqlEnums(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = /create type public\.(\w+)\s+as enum\s*\(([^)]*)\)/gi;
  for (const m of sql.matchAll(re)) {
    out[m[1]!] = [...m[2]!.matchAll(/'([^']+)'/g)].map((v) => v[1]!);
  }
  // `alter type ... add value 'x'` in later migrations
  for (const m of sql.matchAll(
    /alter type public\.(\w+)\s+add value(?: if not exists)?\s+'([^']+)'/gi,
  )) {
    (out[m[1]!] ??= []).push(m[2]!);
  }
  return out;
}

describe('enum contract with supabase/migrations', () => {
  const fromSql = sqlEnums();

  it('every SQL enum exists in packages/shared with the same values in the same order', () => {
    expect(Object.keys(fromSql).length).toBeGreaterThan(40);
    for (const [name, values] of Object.entries(fromSql)) {
      expect(ENUMS[name as keyof typeof ENUMS], `enum ${name} missing in shared`).toEqual(values);
    }
  });

  it('packages/shared declares no enum that SQL does not have', () => {
    expect(Object.keys(ENUMS).sort()).toEqual(Object.keys(fromSql).sort());
  });
});
