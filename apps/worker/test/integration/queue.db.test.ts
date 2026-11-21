/**
 * The job queue and a worker run on Postgres (T1.14). Needs a database with the migrations applied:
 * DATABASE_URL (CI's db job and `pnpm db:start` locally). Skipped without it. Every query is scoped
 * to `test.` job kinds, so a shared database with other queued jobs is left alone.
 */
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, type Database } from '../../src/db.js';
import { createLogger } from '../../src/log.js';
import {
  backlog,
  claim,
  complete,
  deadJobs,
  enqueue,
  fail,
  release,
  releaseStale,
  STALE_LOCK_MINUTES,
  type Scope,
} from '../../src/queue.js';
import { defineJob, runWorker, type AnyJobDefinition, type Task } from '../../src/runner.js';

const URL = process.env.DATABASE_URL;
const scope: Scope = { kindPrefix: 'test.' };
const noTasks = { tick: [], daily: [] };
const quiet = createLogger('error', () => {});

describe.skipIf(!URL)('job queue (Postgres)', () => {
  let db: Database;
  beforeAll(() => {
    db = createDatabase(URL!, { max: 4 });
  });
  afterEach(async () => {
    await db.deleteFrom('private.jobs').where('kind', 'like', 'test.%').execute();
  });
  afterAll(async () => {
    await db.destroy();
  });

  const row = (id: string) =>
    db.selectFrom('private.jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const readyNow = (id: string) =>
    db
      .updateTable('private.jobs')
      .set({ run_after: sql`now()` })
      .where('id', '=', id)
      .execute();
  const run = (
    jobs: Record<string, AnyJobDefinition>,
    extra: Partial<Parameters<typeof runWorker>[0]> = {},
  ) =>
    runWorker({
      mode: 'drain',
      db,
      log: quiet,
      workerId: 'w1',
      jobs,
      tasks: noTasks,
      budgetMs: 60_000,
      scope,
      ...extra,
    });

  it('enqueues once per dedupe key while unfinished; a finished job frees the key', async () => {
    const first = await enqueue(db, 'test.commute', { user: 'u1' }, { dedupeKey: 'test:u1' });
    expect(first).not.toBeNull();
    expect(await enqueue(db, 'test.commute', { user: 'u1' }, { dedupeKey: 'test:u1' })).toBeNull();
    const [job] = await claim(db, 'w1', 10, scope);
    expect(job?.id).toBe(first);
    expect(await complete(db, job!, 'w1')).toBe(true);
    expect((await row(first!)).dedupe_key).toBeNull();
    expect(
      await enqueue(db, 'test.commute', { user: 'u1' }, { dedupeKey: 'test:u1' }),
    ).not.toBeNull();
  });

  it('a claim skips jobs another worker holds, without waiting for it', async () => {
    await enqueue(db, 'test.later', {}, { runAfter: new Date(Date.now() + 3_600_000) });
    for (let i = 0; i < 12; i += 1) await enqueue(db, 'test.ready', { i });
    await db.transaction().execute(async (tx) => {
      // Worker A's claim is not committed yet: its rows stay locked while B claims.
      const a = await claim(tx, 'wa', 4, scope);
      const b = await claim(db, 'wb', 20, scope);
      expect(a).toHaveLength(4);
      expect(b).toHaveLength(8); // the rest, at once (skip locked), not the future job
      const ids = [...a, ...b].map((j) => j.id);
      expect(new Set(ids).size).toBe(12);
    });
    expect(await claim(db, 'wc', 10, scope)).toHaveLength(0);
  });

  it('a failure backs off 2^attempts minutes; out of attempts the job is dead and not claimed', async () => {
    const id = (await enqueue(db, 'test.flaky', {}, { maxAttempts: 2 }))!;
    const [job] = await claim(db, 'w1', 5, scope);
    expect(await fail(db, job!, 'w1', 'Error: boom')).toBe('retry');
    const after = await row(id);
    expect(after.locked_at).toBeNull();
    expect(after.last_error).toBe('Error: boom');
    const waitMin = (new Date(after.run_after as Date).getTime() - Date.now()) / 60_000;
    expect(waitMin).toBeGreaterThan(1.5);
    expect(waitMin).toBeLessThan(2.5);

    await readyNow(id);
    const [again] = await claim(db, 'w1', 5, scope);
    expect(again?.attempts).toBe(2);
    expect(await fail(db, again!, 'w1', 'Error: boom')).toBe('dead');
    await readyNow(id);
    expect(await claim(db, 'w1', 5, scope)).toHaveLength(0);
    expect((await row(id)).done_at).toBeNull();
    expect(await deadJobs(db, scope)).toEqual([{ kind: 'test.flaky', count: 1 }]);
  });

  it('a permanent failure uses up the attempts at once', async () => {
    const id = (await enqueue(db, 'test.bad', {}))!;
    const [job] = await claim(db, 'w1', 5, scope);
    expect(await fail(db, job!, 'w1', 'invalid payload', { permanent: true })).toBe('dead');
    expect((await row(id)).attempts).toBe(5);
  });

  it('releases locks of crashed runs after 15 minutes; the old run can no longer finish or fail it', async () => {
    const id = (await enqueue(db, 'test.slow', {}))!;
    const [job] = await claim(db, 'w-crashed', 5, scope);
    expect(await releaseStale(db, STALE_LOCK_MINUTES, scope)).toBe(0);
    await db
      .updateTable('private.jobs')
      .set({ locked_at: sql`now() - interval '20 minutes'` })
      .where('id', '=', id)
      .execute();
    expect(await releaseStale(db, STALE_LOCK_MINUTES, scope)).toBe(1);
    expect((await row(id)).locked_by).toBeNull();
    const [retry] = await claim(db, 'w-new', 5, scope);
    expect(retry?.attempts).toBe(2);
    expect(await complete(db, job!, 'w-crashed')).toBe(false);
    expect(await fail(db, job!, 'w-crashed', 'late')).toBe('lost');
    expect(await complete(db, retry!, 'w-new')).toBe(true);
  });

  it('gives claimed jobs back unstarted, with their attempt returned', async () => {
    const id = (await enqueue(db, 'test.x', {}))!;
    const jobs = await claim(db, 'w1', 5, scope);
    expect(await release(db, jobs, 'w-other')).toBe(0); // only the holder can
    expect(await release(db, jobs, 'w1')).toBe(1);
    expect(await row(id)).toMatchObject({ attempts: 0, locked_at: null, locked_by: null });
  });

  it('a run: tasks, then jobs; failures stay isolated and dead jobs raise an alert', async () => {
    const seen: number[] = [];
    const jobs: Record<string, AnyJobDefinition> = {
      'test.ok': defineJob({
        payload: z.object({ n: z.number() }),
        run: async (p) => {
          seen.push(p.n);
        },
      }),
      'test.boom': defineJob({
        payload: z.object({}),
        run: async () => {
          throw new Error('handler failed');
        },
      }),
    };
    const ran: string[] = [];
    const tasks: Record<'tick' | 'daily', Task[]> = {
      tick: [
        { name: 'test.task-ok', run: async () => void ran.push('ok') },
        {
          name: 'test.task-bad',
          run: async () => {
            throw new Error('task failed');
          },
        },
        { name: 'test.task-after', run: async () => ({ cleaned: 3 }) },
      ],
      daily: [{ name: 'test.daily', run: async () => void ran.push('daily') }],
    };
    await enqueue(db, 'test.ok', { n: 1 });
    await enqueue(db, 'test.ok', { n: 2 });
    await enqueue(db, 'test.ok', { n: 'two' }); // invalid payload: dead at once
    await enqueue(db, 'test.boom', {}); // handler error: retried later
    const unknown = (await enqueue(db, 'test.unknown', {}))!; // unknown kind: retried later

    const lines: string[] = [];
    const log = createLogger('debug', (l) => lines.push(l));
    const result = await run(jobs, { mode: 'tick', log, tasks });

    expect(ran).toEqual(['ok']); // tick tasks only; the failing one did not stop the next
    expect(result.tasksFailed).toEqual(['test.task-bad']);
    expect(seen.sort()).toEqual([1, 2]);
    expect(result).toMatchObject({ jobsDone: 2, jobsFailed: 3, jobsDead: 1, jobsLost: 0 });
    const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(logged.find((l) => l.task === 'test.task-after')).toMatchObject({ cleaned: 3 });
    expect(logged.filter((l) => l.alert === 'jobs.dead').map((a) => a.kind)).toEqual(['test.ok']);
    expect(logged.find((l) => l.message === 'worker run done')).toMatchObject({
      backlogReady: 0,
      backlogOldestMinutes: 0,
    });
    const boom = await db
      .selectFrom('private.jobs')
      .selectAll()
      .where('kind', '=', 'test.boom')
      .executeTakeFirstOrThrow();
    expect(boom).toMatchObject({ attempts: 1, done_at: null, locked_at: null });
    expect(boom.last_error).toContain('handler failed');
    expect(await row(unknown)).toMatchObject({ attempts: 1, done_at: null });
    expect((await row(unknown)).last_error).toContain('unknown job kind');
  });

  it('SIGTERM in the middle of a batch: the current job finishes, the rest go back unstarted', async () => {
    for (let n = 1; n <= 4; n += 1) await enqueue(db, 'test.ok', { n });
    const stop = new AbortController();
    const seen: number[] = [];
    const jobs = {
      'test.ok': defineJob({
        payload: z.object({ n: z.number() }),
        run: async (p) => {
          seen.push(p.n);
          stop.abort(); // SIGTERM arrives while the first job runs
        },
      }),
    };
    const result = await run(jobs, { signal: stop.signal, batchSize: 4 });
    expect(seen).toEqual([1]);
    expect(result).toMatchObject({ jobsDone: 1, jobsReturned: 3 });
    const left = await db
      .selectFrom('private.jobs')
      .select(['attempts', 'locked_at'])
      .where('kind', '=', 'test.ok')
      .where('done_at', 'is', null)
      .execute();
    expect(left).toEqual(Array(3).fill({ attempts: 0, locked_at: null }));
  });

  it('stops claiming once the budget is used; a slow job times out and is retried', async () => {
    await enqueue(db, 'test.ok', { n: 1 });
    const fast = {
      'test.ok': defineJob({ payload: z.object({ n: z.number() }), run: async () => {} }),
    };
    expect((await run(fast, { budgetMs: 0 })).jobsDone).toBe(0);
    expect((await run(fast)).jobsDone).toBe(1);

    const id = (await enqueue(db, 'test.hang', {}))!;
    let aborted = false;
    const slow = {
      'test.hang': defineJob({
        payload: z.object({}),
        run: (_p, ctx) =>
          new Promise<void>((resolve) =>
            ctx.signal.addEventListener('abort', () => {
              aborted = true;
              resolve();
            }),
          ),
      }),
    };
    const result = await run(slow, { jobTimeoutMs: 50 });
    expect(result).toMatchObject({ jobsDone: 0, jobsFailed: 1 });
    expect(aborted).toBe(true); // the handler was told to stop
    expect((await row(id)).last_error).toMatch(/timed out/);
  });

  it('reports the backlog: ready jobs and how long the oldest has waited', async () => {
    await enqueue(db, 'test.wait', {}, { runAfter: new Date(Date.now() - 45 * 60_000) });
    await enqueue(db, 'test.wait', {});
    await enqueue(db, 'test.wait', {}, { runAfter: new Date(Date.now() + 60_000) });
    expect(await backlog(db, scope)).toEqual({ ready: 2, oldestMinutes: 45 });
  });
});
