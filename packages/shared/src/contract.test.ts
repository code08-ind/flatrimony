/** Contract tests: shared enums and the SQL migrations must never drift (docs/00 "contracts first"). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS } from './constants.js';
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

/** The `create table <name> ( ... );` block, whitespace-normalised. */
function tableBlock(name: string): string {
  const re = new RegExp(`create table ${name.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`, 'i');
  const m = re.exec(sql);
  if (!m) throw new Error(`table ${name} not found in migrations`);
  return m[1]!.replace(/\s+/g, ' ');
}
const norm = (s: string) => s.replace(/\s+/g, ' ');

describe('limits contract with supabase/migrations', () => {
  // [table, expected fragment of its own CREATE TABLE block, whitespace-insensitive]
  const expectations: [string, string][] = [
    ['public.profiles', `char_length(display_name) between 1 and ${LIMITS.displayNameMaxChars}`],
    ['public.profiles', `char_length(bio) <= ${LIMITS.bioMaxChars}`],
    ['public.profiles', `cardinality(languages) <= ${LIMITS.languagesMax}`],
    ['public.profiles', `(current_date - interval '${LIMITS.minAge} years')`],
    ['public.preferences', `budget_min_inr >= ${LIMITS.budgetInr.min}`],
    ['public.preferences', `budget_max_inr <= ${LIMITS.budgetInr.max}`],
    [
      'public.preferences',
      `lease_months between ${LIMITS.leaseMonths.min} and ${LIMITS.leaseMonths.max}`,
    ],
    ['public.preferences', `lease_months smallint not null default ${LIMITS.leaseMonths.default}`],
    ['public.anchors', `char_length(label) between 1 and ${LIMITS.anchorLabelMaxChars}`],
    [
      'public.anchors',
      `max_commute_min between ${LIMITS.commuteMinutes.min} and ${LIMITS.commuteMinutes.max}`,
    ],
    [
      'public.anchors',
      `max_commute_min smallint not null default ${LIMITS.commuteMinutes.default}`,
    ],
    [
      'public.commute_zones',
      `max_minutes between ${LIMITS.commuteMinutes.min} and ${LIMITS.commuteMinutes.max}`,
    ],
    ['public.profile_photos', `position between 0 and ${LIMITS.profilePhotos.max - 1}`],
  ];

  it.each(expectations)('%s enforces: %s', (table, fragment) => {
    expect(tableBlock(table)).toContain(norm(fragment));
  });

  it('preferred areas are capped by the max-rows trigger', () => {
    expect(norm(sql)).toContain(
      `on public.preference_areas for each row execute function public.enforce_max_rows('${LIMITS.preferredAreasMax}'`,
    );
  });

  it('no later migration alters these constraints behind the contract', () => {
    for (const table of new Set(expectations.map(([t]) => t))) {
      const alters = new RegExp(`alter table ${table.replace('.', '\\.')}\\b[^;]*constraint`, 'i');
      expect(
        alters.test(sql),
        `${table} has an ALTER ... CONSTRAINT; update this contract test`,
      ).toBe(false);
    }
  });
});
