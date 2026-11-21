/**
 * What each run does (docs/04 §11). `tick` (every 5 minutes) and `daily` (02:30 IST) are started by
 * Cloud Scheduler (infra/terraform/envs/staging). Job kinds and tasks are added by the tasks that
 * need them: `media.process` (photo processing off the request path), `commute.compute` (T2.9),
 * listing expiry (T3.10), reminders and purges (M5/M6).
 */
import type { WorkerEnv } from './env.js';
import type { AnyJobDefinition, Task } from './runner.js';
import { supabaseStorage } from './storage.js';
import { photoUploadSweep } from './tasks/photo-uploads.js';

/** Job kinds this worker runs. Unknown kinds are marked dead with an alert. */
export const jobs: Record<string, AnyJobDefinition> = {};

export function tasksFor(env: WorkerEnv): {
  tasks: Record<'tick' | 'daily', Task[]>;
  skipped: string[];
} {
  const skipped: string[] = [];
  const daily: Task[] = [];
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
    daily.push(photoUploadSweep(supabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)));
  else skipped.push('photos.sweep-uploads');
  return { tasks: { tick: [], daily }, skipped };
}
