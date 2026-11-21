/**
 * The Postgres job queue (docs/04 §11, ADR-0006): enqueue, claim with FOR UPDATE SKIP LOCKED,
 * complete, fail with exponential backoff, and release locks left by crashed runs.
 */
import { sql } from 'kysely';
import type { Database } from './db.js';

export interface Job {
  id: string;
  kind: string;
  payload: unknown;
  /** Including this run. */
  attempts: number;
  maxAttempts: number;
}

/** Locks older than this belong to a run that crashed or timed out (docs/04 §11). */
export const STALE_LOCK_MINUTES = 15;
/** Backoff after the n-th failed attempt: 2^n minutes (docs/04 §11), at most a day. */
export const backoffMinutes = (attempts: number) => Math.min(2 ** attempts, 24 * 60);

/**
 * Adds a job. With a dedupe key, at most one unfinished job per key exists: a second enqueue is a
 * no-op and returns null (a finished job frees its key; a job out of attempts keeps it until a
 * human looks at it).
 */
export async function enqueue(
  db: Database,
  kind: string,
  payload: Record<string, unknown> = {},
  opts: { runAfter?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): Promise<string | null> {
  const row = await db
    .insertInto('private.jobs')
    .values({
      kind,
      payload: JSON.stringify(payload),
      ...(opts.runAfter ? { run_after: opts.runAfter } : {}),
      ...(opts.dedupeKey ? { dedupe_key: opts.dedupeKey } : {}),
      ...(opts.maxAttempts ? { max_attempts: opts.maxAttempts } : {}),
    })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .returning('id')
    .executeTakeFirst();
  return row ? String(row.id) : null;
}

/** Claims up to `limit` ready jobs for `workerId`; concurrent claimers never get the same job. */
export async function claim(db: Database, workerId: string, limit = 5): Promise<Job[]> {
  const { rows } = await sql<{
    id: string;
    kind: string;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  }>`
    update private.jobs j
       set locked_at = now(), locked_by = ${workerId}, attempts = j.attempts + 1
     where j.id in (
       select id from private.jobs
        where done_at is null and locked_at is null and run_after <= now()
          and attempts < max_attempts
        order by run_after
        for update skip locked
        limit ${limit})
    returning j.id, j.kind, j.payload, j.attempts, j.max_attempts`.execute(db);
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

/** Marks a job done. False when this worker no longer holds its lock (released as stale). */
export async function complete(db: Database, job: Job, workerId: string): Promise<boolean> {
  const res = await db
    .updateTable('private.jobs')
    .set({
      done_at: sql`now()`,
      locked_at: null,
      locked_by: null,
      last_error: null,
      dedupe_key: null,
    })
    .where('id', '=', job.id)
    .where('locked_by', '=', workerId)
    .executeTakeFirst();
  return res.numUpdatedRows > 0n;
}

/**
 * Records a failure and schedules the retry (2^attempts minutes). `permanent` (an unknown kind, an
 * invalid payload) uses up the remaining attempts at once. Returns true when the job is out of
 * attempts ("dead": it stays undone for an alert and a human).
 */
export async function fail(
  db: Database,
  job: Job,
  workerId: string,
  error: string,
  opts: { permanent?: boolean } = {},
): Promise<boolean> {
  const dead = opts.permanent || job.attempts >= job.maxAttempts;
  await db
    .updateTable('private.jobs')
    .set({
      locked_at: null,
      locked_by: null,
      last_error: error.slice(0, 2000),
      ...(opts.permanent ? { attempts: sql`max_attempts` } : {}),
      run_after: sql`now() + make_interval(mins => ${backoffMinutes(job.attempts)})`,
    })
    .where('id', '=', job.id)
    .where('locked_by', '=', workerId)
    .execute();
  return dead;
}

/** Frees jobs locked by runs that crashed or timed out; their attempt still counts. */
export async function releaseStale(db: Database, minutes = STALE_LOCK_MINUTES): Promise<number> {
  const res = await db
    .updateTable('private.jobs')
    .set({
      locked_at: null,
      locked_by: null,
      last_error: 'lock expired (worker crashed or timed out)',
    })
    .where('done_at', 'is', null)
    .where('locked_at', '<', sql<Date>`now() - make_interval(mins => ${minutes})`)
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

/** Jobs out of attempts and still undone (alerted on every run until someone handles them). */
export async function deadJobs(db: Database): Promise<{ kind: string; count: number }[]> {
  const rows = await db
    .selectFrom('private.jobs')
    .select(['kind', (eb) => eb.fn.countAll<string>().as('count')])
    .where('done_at', 'is', null)
    .where('locked_at', 'is', null)
    .whereRef('attempts', '>=', 'max_attempts')
    .groupBy('kind')
    .execute();
  return rows.map((r) => ({ kind: r.kind, count: Number(r.count) }));
}
