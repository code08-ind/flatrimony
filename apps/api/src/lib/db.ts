/** Kysely over node-postgres (docs/03 §2.1). One pool per process; transaction-mode pooler URL in Cloud Run. */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from '@flatrimony/db-types';

export type Database = Kysely<DB>;

// Postgres DATE (oid 1082) stays a 'YYYY-MM-DD' string. node-pg's default turns it into a JS Date at
// local midnight, which shifts a date of birth by a day when the process TZ is not UTC. Matches the
// `--date-parser string` setting used to generate @flatrimony/db-types.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export function createDatabase(url: string, opts: { max?: number } = {}): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'flatrimony-api',
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
