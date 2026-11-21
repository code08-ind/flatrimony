/**
 * What each run does (docs/04 §11). `tick` (every 5 minutes) and `daily` (02:30 IST) are started by
 * Cloud Scheduler (infra/terraform/envs/staging). Job kinds and tasks are added by the tasks that
 * need them: `commute.compute` (T2.9) is here; `media.process` (photo processing off the request
 * path), listing expiry (T3.10), reminders and purges (M5/M6) come with theirs.
 */
import { googleIdToken } from '@flatrimony/routing';
import type { WorkerEnv } from './env.js';
import { COMMUTE_KIND, commuteJob, commuteRefresh, type RoutingConfig } from './jobs/commute.js';
import type { AnyJobDefinition, Task } from './runner.js';
import { supabaseStorage } from './storage.js';
import { photoUploadSweep } from './tasks/photo-uploads.js';

/** How the worker reaches the routing service: a Google ID token on Cloud Run, none locally. */
export function routingFor(env: WorkerEnv): RoutingConfig {
  return {
    url: env.ROUTING_URL,
    ...(env.APP_ENV === 'local' ? {} : { token: (audience: string) => googleIdToken(audience) }),
  };
}

/** Job kinds this worker runs. Unknown kinds are retried, then dead with an alert. */
export function jobsFor(env: WorkerEnv): Record<string, AnyJobDefinition> {
  return { [COMMUTE_KIND]: commuteJob(routingFor(env)) };
}

export function tasksFor(env: WorkerEnv): {
  tasks: Record<'tick' | 'daily', Task[]>;
  skipped: string[];
} {
  const skipped: string[] = [];
  const daily: Task[] = [commuteRefresh()];
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
    daily.push(photoUploadSweep(supabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)));
  else skipped.push('photos.sweep-uploads');
  return { tasks: { tick: [], daily }, skipped };
}
