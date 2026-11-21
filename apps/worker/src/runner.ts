/**
 * One worker run (a Cloud Run Job execution, docs/04 §11): release stale locks, run the scheduled
 * tasks of the mode (`tick` every 5 minutes, `daily` at 02:30 IST, `drain` none), then work through
 * ready jobs until the queue is empty or the time budget is used. Jobs and tasks are isolated: one
 * failure never stops the others.
 */
import type { z } from 'zod';
import type { Database } from './db.js';
import { errorFields, type Logger } from './log.js';
import {
  backlog,
  claim,
  complete,
  deadJobs,
  fail,
  release,
  releaseStale,
  STALE_LOCK_MINUTES,
  type Job,
  type Scope,
} from './queue.js';

/**
 * One job may run this long; it then counts as failed and its signal is aborted. Well under the
 * 15-minute stale-lock age, so a slow job is never released and run twice at the same time.
 */
export const JOB_TIMEOUT_MS = 5 * 60_000;

export type Mode = 'tick' | 'daily' | 'drain';
export const MODES: readonly Mode[] = ['tick', 'daily', 'drain'];

export interface Context {
  db: Database;
  log: Logger;
  /** Aborted when Cloud Run stops the task (SIGTERM): finish quickly, do not start new work. */
  signal: AbortSignal;
}

/**
 * A job kind: how to check its payload and how to run it. Runs must be idempotent (retries) and
 * should stop when `ctx.signal` aborts (SIGTERM or the per-job timeout).
 */
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
  /** Finished or failed after this run's lock was released (another run may have taken it). */
  jobsLost: number;
  /** Claimed but not started (stopping): given back with their attempt. */
  jobsReturned: number;
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
  jobTimeoutMs?: number;
  /** Tests only: work on these job kinds alone. */
  scope?: Scope;
}): Promise<RunResult> {
  const { mode, db, log, workerId } = opts;
  const now = opts.now ?? Date.now;
  const signal = opts.signal ?? new AbortController().signal;
  const deadline = now() + opts.budgetMs;
  const ctx: Context = { db, log, signal };
  const scope = opts.scope ?? {};
  const result: RunResult = {
    staleReleased: 0,
    tasksFailed: [],
    jobsDone: 0,
    jobsFailed: 0,
    jobsDead: 0,
    jobsLost: 0,
    jobsReturned: 0,
  };
  const stopping = () => signal.aborted || now() >= deadline;

  result.staleReleased = await releaseStale(db, STALE_LOCK_MINUTES, scope);
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

  const timeoutMs = opts.jobTimeoutMs ?? JOB_TIMEOUT_MS;
  while (!stopping()) {
    const batch = await claim(db, workerId, opts.batchSize ?? 5, scope);
    if (batch.length === 0) break;
    for (const [i, job] of batch.entries()) {
      if (stopping()) {
        // SIGTERM or out of time: the rest of the batch goes back unstarted, attempt returned.
        result.jobsReturned += await release(db, batch.slice(i), workerId);
        break;
      }
      const outcome = await runJob(job, opts.jobs, { ...ctx, workerId }, timeoutMs);
      if (outcome === 'done') result.jobsDone += 1;
      else if (outcome === 'lost') result.jobsLost += 1;
      else {
        result.jobsFailed += 1;
        if (outcome === 'dead') result.jobsDead += 1;
      }
    }
  }

  // Alert while any job is out of attempts (a log-based alert on this message, docs/03 §10).
  for (const { kind, count } of await deadJobs(db, scope))
    log.error('jobs out of attempts', { alert: 'jobs.dead', kind, count });
  // Queue depth after the run, for the backlog alert (docs/03 §13).
  const left = await backlog(db, scope);

  log.info('worker run done', {
    mode,
    ...result,
    tasksFailed: result.tasksFailed.length,
    backlogReady: left.ready,
    backlogOldestMinutes: left.oldestMinutes,
  });
  return result;
}

async function runJob(
  job: Job,
  jobs: Record<string, AnyJobDefinition>,
  ctx: Context & { workerId: string },
  timeoutMs: number,
): Promise<'done' | 'failed' | 'dead' | 'lost'> {
  const fields = { jobId: job.id, kind: job.kind, attempt: job.attempts };
  const record = async (error: string, permanent: boolean, logFields: Record<string, unknown>) => {
    const outcome = await fail(ctx.db, job, ctx.workerId, error, { permanent });
    const level = outcome === 'retry' ? 'warn' : 'error';
    ctx.log[level]('job failed', { ...fields, ...logFields, outcome });
    return outcome === 'retry' ? 'failed' : outcome;
  };

  const definition = (jobs as Record<string, JobDefinition<unknown>>)[job.kind];
  // Retried, not dead at once: during a deploy or a rollback the running image may not know a
  // kind that the API (or a newer image) enqueues yet.
  if (!definition) return record(`unknown job kind ${job.kind}`, false, { reason: 'unknown kind' });
  const payload = definition.payload.safeParse(job.payload);
  if (!payload.success) {
    const paths = payload.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    return record(`invalid payload: ${paths}`, true, { reason: 'invalid payload', paths });
  }

  const started = Date.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = AbortSignal.any([ctx.signal, timeout.signal]);
  try {
    await Promise.race([
      definition.run(payload.data, { ...ctx, signal, job }),
      new Promise<never>((_, reject) =>
        timeout.signal.addEventListener('abort', () =>
          reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`)),
        ),
      ),
    ]);
  } catch (err) {
    const e = errorFields(err);
    return record(`${e.err}: ${e.errMessage}`, false, e);
  } finally {
    clearTimeout(timer);
  }
  if (!(await complete(ctx.db, job, ctx.workerId))) {
    ctx.log.warn('job finished after its lock was released', fields);
    return 'lost';
  }
  ctx.log.info('job done', { ...fields, ms: Date.now() - started });
  return 'done';
}
