/**
 * The job queue and a worker run on Postgres (T1.14). Needs a database with the migrations applied:
 * DATABASE_URL (CI's db job and `pnpm db:start` locally). Skipped without it.
 */
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, type Database } from '../../src/db.js';
import { createLogger } from '../../src/log.js';
import { claim, complete, enqueue, fail, releaseStale } from '../../src/queue.js';
import { defineJob, runWorker, type AnyJobDefinition, type Task } from '../../src/runner.js';

const URL = process.env.DATABASE_URL;

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

  it('enqueues once per dedupe key while unfinished; a finished job frees the key', async () => {
    const first = await enqueue(db, 'test.commute', { user: 'u1' }, { dedupeKey: 'test:u1' });
    expect(first).not.toBeNull();
    expect(await enqueue(db, 'test.commute', { user: 'u1' }, { dedupeKey: 'test:u1' })).toBeNull();
    const [job] = await claim(db, 'w1', 10);
    expect(job?.id).toBe(first);
    expect(await complete(db, job!, 'w1')).toBe(true);
    expect((await row(first!)).dedupe_key).toBeNull();
    expect(
      await enqueue(db, 'test.commute', { user: 'u1' }, { dedupeKey: 'test:u1' }),
    ).not.toBeNull();
  });

  it('claims only ready jobs, and two workers at once never get the same job', async () => {
    await enqueue(db, 'test.later', {}, { runAfter: new Date(Date.now() + 3_600_000) });
    for (let i = 0; i < 12; i += 1) await enqueue(db, 'test.ready', { i });
    const [a, b] = await Promise.all([claim(db, 'wa', 8), claim(db, 'wb', 8)]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length); // no job twice
    expect(ids).toHaveLength(12); // every ready job, none of the later one
    expect([...a, ...b].every((j) => j.kind === 'test.ready' && j.attempts === 1)).toBe(true);
    expect(await claim(db, 'wc', 10)).toHaveLength(0);
  });

  it('a failure backs off 2^attempts minutes; out of attempts the job is dead and not claimed', async () => {
    const id = (await enqueue(db, 'test.flaky', {}, { maxAttempts: 2 }))!;
    const [job] = await claim(db, 'w1');
    expect(await fail(db, job!, 'w1', 'Error: boom')).toBe(false);
    const after = await row(id);
    expect(after.locked_at).toBeNull();
    expect(after.last_error).toBe('Error: boom');
    const waitMin = (new Date(after.run_after as Date).getTime() - Date.now()) / 60_000;
    expect(waitMin).toBeGreaterThan(1.5);
    expect(waitMin).toBeLessThan(2.5);

    await db
      .updateTable('private.jobs')
      .set({ run_after: sql`now()` })
      .where('id', '=', id)
      .execute();
    const [again] = await claim(db, 'w1');
    expect(again?.attempts).toBe(2);
    expect(await fail(db, again!, 'w1', 'Error: boom')).toBe(true);
    await db
      .updateTable('private.jobs')
      .set({ run_after: sql`now()` })
      .where('id', '=', id)
      .execute();
    expect(await claim(db, 'w1')).toHaveLength(0);
    expect((await row(id)).done_at).toBeNull();
  });

  it('a permanent failure uses up the attempts at once', async () => {
    const id = (await enqueue(db, 'test.bad', {}))!;
    const [job] = await claim(db, 'w1');
    expect(await fail(db, job!, 'w1', 'invalid payload', { permanent: true })).toBe(true);
    expect((await row(id)).attempts).toBe(5);
  });

  it('releases locks of crashed runs after 15 minutes; the late finisher is told', async () => {
    const id = (await enqueue(db, 'test.slow', {}))!;
    const [job] = await claim(db, 'w-crashed');
    expect(await releaseStale(db)).toBe(0);
    await db
      .updateTable('private.jobs')
      .set({ locked_at: sql`now() - interval '20 minutes'` })
      .where('id', '=', id)
      .execute();
    expect(await releaseStale(db)).toBe(1);
    expect((await row(id)).locked_by).toBeNull();
    const [retry] = await claim(db, 'w-new');
    expect(retry?.attempts).toBe(2);
    expect(await complete(db, job!, 'w-crashed')).toBe(false); // the old run no longer owns it
    expect(await complete(db, retry!, 'w-new')).toBe(true);
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
    await enqueue(db, 'test.ok', { n: 'two' }); // invalid payload
    await enqueue(db, 'test.boom', {});
    await enqueue(db, 'test.unknown', {});

    const lines: string[] = [];
    const log = createLogger('debug', (l) => lines.push(l));
    const result = await runWorker({
      mode: 'tick',
      db,
      log,
      workerId: 'w1',
      jobs,
      tasks,
      budgetMs: 60_000,
    });

    expect(ran).toEqual(['ok']); // tick tasks only, the failing one did not stop the next
    expect(result.tasksFailed).toEqual(['test.task-bad']);
    expect(seen.sort()).toEqual([1, 2]);
    expect(result).toMatchObject({ jobsDone: 2, jobsFailed: 3, jobsDead: 2 });
    const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(logged.find((l) => l.task === 'test.task-after')).toMatchObject({ cleaned: 3 });
    const alerts = logged.filter((l) => l.alert === 'jobs.dead');
    expect(alerts.map((a) => a.kind).sort()).toEqual(['test.ok', 'test.unknown']);
    // The failing handler is retried later, not dead.
    const boom = await db
      .selectFrom('private.jobs')
      .selectAll()
      .where('kind', '=', 'test.boom')
      .executeTakeFirstOrThrow();
    expect(boom).toMatchObject({ attempts: 1, done_at: null, locked_at: null });
    expect(boom.last_error).toContain('handler failed');
  });

  it('a run stops claiming once its budget is used, and on SIGTERM', async () => {
    await enqueue(db, 'test.ok', { n: 1 });
    const jobs = {
      'test.ok': defineJob({ payload: z.object({ n: z.number() }), run: async () => {} }),
    };
    const log = createLogger('error', () => {});
    const empty = { tick: [], daily: [] };
    const out = await runWorker({
      mode: 'drain',
      db,
      log,
      workerId: 'w1',
      jobs,
      tasks: empty,
      budgetMs: 0,
    });
    expect(out.jobsDone).toBe(0);
    const stop = new AbortController();
    stop.abort();
    const out2 = await runWorker({
      mode: 'drain',
      db,
      log,
      workerId: 'w1',
      jobs,
      tasks: empty,
      budgetMs: 60_000,
      signal: stop.signal,
    });
    expect(out2.jobsDone).toBe(0);
    const out3 = await runWorker({
      mode: 'drain',
      db,
      log,
      workerId: 'w1',
      jobs,
      tasks: empty,
      budgetMs: 60_000,
    });
    expect(out3.jobsDone).toBe(1);
  });
});
