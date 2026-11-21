/** Kysely over node-postgres, like the API (apps/api/src/lib/db.ts), with a small pool. */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from '@flatrimony/db-types';

export type Database = Kysely<DB>;

// Keep DATE columns as 'YYYY-MM-DD' strings (same as the API and the generated types).
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export function createDatabase(url: string, opts: { max?: number } = {}): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'flatrimony-worker',
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
