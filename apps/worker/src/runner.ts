/**
 * One worker run (a Cloud Run Job execution, docs/04 §11): release stale locks, run the scheduled
 * tasks of the mode (`tick` every 5 minutes, `daily` at 02:30 IST, `drain` none), then work through
 * ready jobs until the queue is empty or the time budget is used. Jobs and tasks are isolated: one
 * failure never stops the others.
 */
import type { z } from 'zod';
import type { Database } from './db.js';
import { errorFields, type Logger } from './log.js';
import { claim, complete, deadJobs, fail, releaseStale, type Job } from './queue.js';

export type Mode = 'tick' | 'daily' | 'drain';
export const MODES: readonly Mode[] = ['tick', 'daily', 'drain'];

export interface Context {
  db: Database;
  log: Logger;
  /** Aborted when Cloud Run stops the task (SIGTERM): finish quickly, do not start new work. */
  signal: AbortSignal;
}

/** A job kind: how to check its payload and how to run it. Runs must be idempotent (retries). */
export interface JobDefinition<T = unknown> {
  payload: z.ZodType<T>;
  run(payload: T, ctx: Context & { job: Job }): Promise<void>;
}

/** A registry entry: any job definition, its payload type checked at definition time. */
export type AnyJobDefinition = JobDefinition<never>;

/** Declares a job kind with a typed payload, ready for the registry. */
export const defineJob = <T>(definition: JobDefinition<T>): AnyJobDefinition =>
  definition as unknown as AnyJobDefinition;

/** A scheduled task: idempotent, safe to run while another run of it is still going. */
export interface Task {
  name: string;
  /** Returns counts to log (never personal data). */
  run(ctx: Context): Promise<Record<string, number> | void>;
}

export interface RunResult {
  staleReleased: number;
  tasksFailed: string[];
  jobsDone: number;
  jobsFailed: number;
  jobsDead: number;
}

export async function runWorker(opts: {
  mode: Mode;
  db: Database;
  log: Logger;
  workerId: string;
  jobs: Record<string, AnyJobDefinition>;
  tasks: Record<'tick' | 'daily', Task[]>;
  /** Stop claiming new jobs after this many ms. */
  budgetMs: number;
  signal?: AbortSignal;
  now?: () => number;
  batchSize?: number;
}): Promise<RunResult> {
  const { mode, db, log, workerId } = opts;
  const now = opts.now ?? Date.now;
  const signal = opts.signal ?? new AbortController().signal;
  const deadline = now() + opts.budgetMs;
  const ctx: Context = { db, log, signal };
  const result: RunResult = {
    staleReleased: 0,
    tasksFailed: [],
    jobsDone: 0,
    jobsFailed: 0,
    jobsDead: 0,
  };

  result.staleReleased = await releaseStale(db);
  if (result.staleReleased > 0)
    log.warn('released stale job locks', { count: result.staleReleased });

  if (mode !== 'drain')
    for (const task of opts.tasks[mode]) {
      if (signal.aborted) break;
      const started = now();
      try {
        const counts = await task.run(ctx);
        log.info('task done', { task: task.name, ms: now() - started, ...(counts ?? {}) });
      } catch (err) {
        result.tasksFailed.push(task.name);
        log.error('task failed', { task: task.name, ms: now() - started, ...errorFields(err) });
      }
    }

  while (!signal.aborted && now() < deadline) {
    const batch = await claim(db, workerId, opts.batchSize ?? 5);
    if (batch.length === 0) break;
    for (const job of batch) {
      const outcome = await runJob(job, opts.jobs, { ...ctx, workerId });
      if (outcome === 'done') result.jobsDone += 1;
      else {
        result.jobsFailed += 1;
        if (outcome === 'dead') result.jobsDead += 1;
      }
    }
  }

  // Alert while any job is out of attempts (a log-based alert on this message, docs/03 §10).
  for (const { kind, count } of await deadJobs(db))
    log.error('jobs out of attempts', { alert: 'jobs.dead', kind, count });

  log.info('worker run done', { mode, ...result, tasksFailed: result.tasksFailed.length });
  return result;
}

async function runJob(
  job: Job,
  jobs: Record<string, AnyJobDefinition>,
  ctx: Context & { workerId: string },
): Promise<'done' | 'failed' | 'dead'> {
  const fields = { jobId: job.id, kind: job.kind, attempt: job.attempts };
  const definition = (jobs as Record<string, JobDefinition<unknown>>)[job.kind];
  if (!definition) {
    await fail(ctx.db, job, ctx.workerId, `unknown job kind ${job.kind}`, { permanent: true });
    ctx.log.error('unknown job kind', fields);
    return 'dead';
  }
  const payload = definition.payload.safeParse(job.payload);
  if (!payload.success) {
    const paths = payload.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    await fail(ctx.db, job, ctx.workerId, `invalid payload: ${paths}`, { permanent: true });
    ctx.log.error('invalid job payload', { ...fields, paths });
    return 'dead';
  }
  const started = Date.now();
  try {
    await definition.run(payload.data, { ...ctx, job });
  } catch (err) {
    const e = errorFields(err);
    const dead = await fail(ctx.db, job, ctx.workerId, `${e.err}: ${e.errMessage}`);
    ctx.log[dead ? 'error' : 'warn']('job failed', { ...fields, dead, ...e });
    return dead ? 'dead' : 'failed';
  }
  if (!(await complete(ctx.db, job, ctx.workerId)))
    ctx.log.warn('job finished after its lock was released', fields);
  else ctx.log.info('job done', { ...fields, ms: Date.now() - started });
  return 'done';
}
