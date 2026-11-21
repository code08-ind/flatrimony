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

/**
 * Limits queue operations to job kinds starting with this prefix. Production runs leave it unset;
 * tests set it so they never touch other rows in a shared database.
 */
export interface Scope {
  kindPrefix?: string;
}
const kindFilter = (scope: Scope) =>
  scope.kindPrefix ? sql`and kind like ${`${scope.kindPrefix}%`}` : sql``;

/** Claims up to `limit` ready jobs for `workerId`; concurrent claimers never get the same job. */
export async function claim(
  db: Database,
  workerId: string,
  limit = 5,
  scope: Scope = {},
): Promise<Job[]> {
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
          and attempts < max_attempts ${kindFilter(scope)}
        order by run_after
        for update skip locked
        limit ${limit})
    returning j.id, j.kind, j.payload, j.attempts, j.max_attempts`.execute(db);
  return rows
    .map((r) => ({
      id: String(r.id),
      kind: r.kind,
      payload: r.payload,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
    }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Gives claimed jobs back without running them (the run is stopping): unlocked, and the attempt
 * the claim counted is returned. Only jobs this worker still holds.
 */
export async function release(db: Database, jobs: Job[], workerId: string): Promise<number> {
  if (jobs.length === 0) return 0;
  const res = await db
    .updateTable('private.jobs')
    .set({ locked_at: null, locked_by: null, attempts: sql`greatest(attempts - 1, 0)` })
    .where(
      'id',
      'in',
      jobs.map((j) => j.id),
    )
    .where('locked_by', '=', workerId)
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

/**
 * Marks a job done. A job asked to run again while it ran (`requestRun` moved its `run_after`
 * past the moment it was claimed) goes back to the queue instead, with fresh attempts and its
 * dedupe key. False when this worker no longer holds its lock (released as stale).
 */
export async function complete(db: Database, job: Job, workerId: string): Promise<boolean> {
  const rerun = sql<boolean>`run_after > locked_at`;
  const res = await db
    .updateTable('private.jobs')
    .set({
      done_at: sql`case when ${rerun} then null else now() end`,
      dedupe_key: sql`case when ${rerun} then dedupe_key else null end`,
      attempts: sql`case when ${rerun} then 0 else attempts end`,
      locked_at: null,
      locked_by: null,
      last_error: null,
    })
    .where('id', '=', job.id)
    .where('locked_by', '=', workerId)
    .executeTakeFirst();
  return res.numUpdatedRows > 0n;
}

/**
 * Records a failure and schedules the retry (2^attempts minutes). `permanent` (an invalid payload)
 * uses up the remaining attempts at once. Returns 'dead' when the job is out of attempts (it stays
 * undone for an alert and a human), 'retry' otherwise, and 'lost' when this worker no longer held
 * the lock (another run released and may have taken it; nothing was recorded).
 */
export async function fail(
  db: Database,
  job: Job,
  workerId: string,
  error: string,
  opts: { permanent?: boolean } = {},
): Promise<'retry' | 'dead' | 'lost'> {
  const res = await db
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
    .executeTakeFirst();
  if (res.numUpdatedRows === 0n) return 'lost';
  return opts.permanent || job.attempts >= job.maxAttempts ? 'dead' : 'retry';
}

/**
 * Asks for a job with this dedupe key to run (again), e.g. when the data it works on changed:
 * a waiting or dead job is pulled forward with fresh attempts; a running one runs once more after
 * it finishes (see `complete`); with none, a new one is added. `clock_timestamp()`: after waiting
 * for a running job's lock it is later than that job's claim. The same statement as the API's
 * (apps/api, PUT /me/anchor).
 */
export async function requestRun(
  db: Database,
  kind: string,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  await sql`
    insert into private.jobs (kind, payload, dedupe_key)
    values (${kind}, ${JSON.stringify(payload)}::jsonb, ${dedupeKey})
    on conflict (dedupe_key) do update
      set run_after = clock_timestamp(),
          attempts = case when private.jobs.locked_at is null then 0 else private.jobs.attempts end,
          last_error = case when private.jobs.locked_at is null then null else private.jobs.last_error end
      where private.jobs.done_at is null`.execute(db);
}

/** Frees jobs locked by runs that crashed or timed out; their attempt still counts. */
export async function releaseStale(
  db: Database,
  minutes = STALE_LOCK_MINUTES,
  scope: Scope = {},
): Promise<number> {
  let q = db
    .updateTable('private.jobs')
    .set({
      locked_at: null,
      locked_by: null,
      last_error: 'lock expired (worker crashed or timed out)',
    })
    .where('done_at', 'is', null)
    .where('locked_at', '<', sql<Date>`now() - make_interval(mins => ${minutes})`);
  if (scope.kindPrefix) q = q.where('kind', 'like', `${scope.kindPrefix}%`);
  return Number((await q.executeTakeFirst()).numUpdatedRows);
}

/** Jobs out of attempts and still undone (alerted on every run until someone handles them). */
export async function deadJobs(
  db: Database,
  scope: Scope = {},
): Promise<{ kind: string; count: number }[]> {
  let q = db
    .selectFrom('private.jobs')
    .select(['kind', (eb) => eb.fn.countAll<string>().as('count')])
    .where('done_at', 'is', null)
    .where('locked_at', 'is', null)
    .whereRef('attempts', '>=', 'max_attempts');
  if (scope.kindPrefix) q = q.where('kind', 'like', `${scope.kindPrefix}%`);
  const rows = await q.groupBy('kind').execute();
  return rows.map((r) => ({ kind: r.kind, count: Number(r.count) }));
}

/** Ready jobs left after a run and how long the oldest has waited (docs/03 §13: backlog). */
export async function backlog(
  db: Database,
  scope: Scope = {},
): Promise<{ ready: number; oldestMinutes: number }> {
  const { rows } = await sql<{ ready: string; oldest: number | null }>`
    select count(*)::text as ready,
           extract(epoch from now() - min(run_after)) / 60 as oldest
      from private.jobs
     where done_at is null and locked_at is null and run_after <= now()
       and attempts < max_attempts ${kindFilter(scope)}`.execute(db);
  return {
    ready: Number(rows[0]?.ready ?? 0),
    oldestMinutes: Math.max(0, Math.round(Number(rows[0]?.oldest ?? 0))),
  };
}
