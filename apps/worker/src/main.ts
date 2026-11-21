/**
 * Entry point of the worker Cloud Run Job: `node dist/main.js <tick|daily|drain>`.
 * Exit code 1 when a scheduled task failed (the execution shows as failed in Cloud Run); failed
 * jobs are retried through the queue and do not fail the run. Exit code 2 for a bad invocation.
 */
import { createDatabase } from './db.js';
import { loadEnv, workerId } from './env.js';
import { createLogger, errorFields } from './log.js';
import { MODES, runWorker, type Mode } from './runner.js';
import { jobs, tasksFor } from './schedule.js';

const mode = process.argv[2] as Mode;
if (!MODES.includes(mode)) {
  process.stderr.write(`Usage: main.js <${MODES.join('|')}>\n`);
  process.exit(2);
}

const env = loadEnv();
const id = workerId(env);
const log = createLogger(env.LOG_LEVEL, undefined, { worker: id, mode, appEnv: env.APP_ENV });
const db = createDatabase(env.databaseUrl);
const abort = new AbortController();
process.once('SIGTERM', () => {
  log.warn('SIGTERM: finishing the current job, then stopping');
  abort.abort();
});

let code = 0;
try {
  const { tasks, skipped } = tasksFor(env);
  if (skipped.length > 0) log.warn('tasks skipped: not configured', { tasks: skipped.join(',') });
  const result = await runWorker({
    mode,
    db,
    log,
    workerId: id,
    jobs,
    tasks,
    budgetMs: env.WORKER_BUDGET_SECONDS * 1000,
    signal: abort.signal,
  });
  if (result.tasksFailed.length > 0) code = 1;
} catch (err) {
  log.error('worker run failed', errorFields(err));
  code = 1;
} finally {
  await db.destroy();
}
process.exit(code);
