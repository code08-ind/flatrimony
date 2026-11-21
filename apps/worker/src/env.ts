import { z } from 'zod';

/** Worker configuration (docs/03 §5.2). Secrets come from Secret Manager in Cloud Run. */
const Env = z
  .object({
    NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
    APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** Direct connection (not the transaction pooler): jobs may hold a transaction for a while. */
    DATABASE_URL_DIRECT: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    /** Storage tasks (photo upload sweep) need both; without them those tasks are skipped. */
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    /** Cloud Run sets these for jobs; they name the worker in job locks. */
    CLOUD_RUN_EXECUTION: z.string().optional(),
    CLOUD_RUN_TASK_INDEX: z.string().optional(),
    /** Stop claiming new jobs after this long (the Cloud Run task timeout is 10 minutes). */
    WORKER_BUDGET_SECONDS: z.coerce.number().int().min(10).max(3600).default(480),
  })
  .transform((env, ctx) => {
    const databaseUrl = env.DATABASE_URL_DIRECT ?? env.DATABASE_URL;
    if (!databaseUrl) {
      ctx.addIssue({
        code: 'custom',
        message: 'DATABASE_URL_DIRECT (or DATABASE_URL) is required',
      });
      return z.NEVER;
    }
    return { ...env, databaseUrl };
  });

export type WorkerEnv = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    // Names only: values may be secrets.
    const names = parsed.error.issues.map((i) => i.path.join('.') || i.message).join(', ');
    throw new Error(`Invalid worker configuration: ${names}`);
  }
  return parsed.data;
}

/** The lock holder name: the Cloud Run execution and task, or the host and process. */
export function workerId(env: WorkerEnv, pid = process.pid): string {
  return env.CLOUD_RUN_EXECUTION
    ? `${env.CLOUD_RUN_EXECUTION}/${env.CLOUD_RUN_TASK_INDEX ?? '0'}`
    : `local-${pid}`;
}
